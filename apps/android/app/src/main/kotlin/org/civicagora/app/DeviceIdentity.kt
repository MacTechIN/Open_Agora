package org.civicagora.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.os.Build
import org.civicagora.core.didFromPublicKey
import android.security.keystore.KeyInfo
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * 기기 신원 (VS-A2).
 *
 * 개인키는 Android Keystore 안에서 생성되고 **절대 밖으로 나오지 않습니다.**
 * 서명은 Keystore가 수행하고, 앱은 핸들만 쥡니다. 공유 코어에도 개인키를
 * 넘기지 않으므로, 코어가 실수로 유출할 경로 자체가 없습니다.
 *
 * ## 곡선이 P-256인 이유
 *
 * 명세는 secp256k1을 적었으나 **StrongBox는 P-256만 지원합니다.**
 * secp256k1을 쓰려면 소프트웨어 키로 내려와야 하고, 그러면 개인키가 앱
 * 메모리에 올라와 VS-A2의 수용 기준을 어깁니다. 하드웨어 보호를 택했습니다.
 *
 * 명세: docs/09_DEVELOPMENT_PLAN.md VS-A2
 */
object DeviceIdentity {

    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "org.civicagora.device-identity.v1"

    /** 하드웨어 보호 여부. UI에 표시해 사용자가 자신의 보호 수준을 알 수 있게 한다. */
    enum class Protection { STRONGBOX, TEE, SOFTWARE }

    data class Identity(val did: String, val protection: Protection)

    /**
     * 기기 신원을 가져오거나 없으면 만든다.
     *
     * 이미 있으면 같은 키를 쓰므로 재실행해도 DID가 유지된다. 앱을 삭제하면
     * Keystore 항목도 함께 사라져 새 신원이 발급된다 — 복구 구문(VS-C4)이
     * 없는 현재 단계에서는 이것이 의도된 동작이다.
     */
    fun loadOrCreate(): Identity {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }

        if (!store.containsAlias(ALIAS)) {
            generate()
        }
        // 생성 경로가 무엇이었든 실제 보관 위치를 읽어 표시한다.
        // StrongBox를 요청했다고 StrongBox에 들어간다는 보장은 없다.
        val protection = detectProtection(store)

        val publicKey = store.getCertificate(ALIAS).publicKey
        // 코어는 SEC1 인코딩 점을 받는다. Android는 X.509 SubjectPublicKeyInfo로
        // 내보내므로 마지막 65바이트(비압축 점)를 꺼낸다.
        val encoded = publicKey.encoded
        val sec1 = encoded.copyOfRange(encoded.size - 65, encoded.size)

        return Identity(didFromPublicKey(sec1), protection)
    }

    /**
     * Keystore 개인키로 서명한다. 개인키는 이 함수 안에서도 노출되지 않는다.
     *
     * 반환 형식은 DER이므로 코어가 요구하는 P1363(r‖s)로 변환한다.
     */
    fun sign(message: ByteArray): ByteArray {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val key = store.getKey(ALIAS, null) as PrivateKey
        val der = Signature.getInstance("SHA256withECDSA").run {
            initSign(key)
            update(message)
            sign()
        }
        return derToP1363(der)
    }

    /** StrongBox를 우선 시도하고, 없는 기기에서는 일반 Keystore로 내려앉는다. */
    private fun generate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                createKey(strongBox = true)
                return
            } catch (_: Exception) {
                // StrongBox 미탑재 기기가 다수다. 실패는 정상 경로다.
            }
        }
        createKey(strongBox = false)
    }

    private fun createKey(strongBox: Boolean) {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            // 생체 인증 요구는 VS-C3에서 가입 흐름과 함께 붙인다.
            .setUserAuthenticationRequired(false)
            .apply {
                if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    setIsStrongBoxBacked(true)
                }
            }
            .build()

        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE).run {
            initialize(spec)
            generateKeyPair()
        }
    }

    /**
     * 키가 실제로 어디에 보관되는지 읽는다.
     *
     * 추측하지 않는다. 사용자에게 "하드웨어로 보호된다"고 표시해 놓고 실제로는
     * 소프트웨어였다면, 그것은 잘못된 안심을 주는 것이다.
     */
    private fun detectProtection(store: KeyStore): Protection {
        return try {
            val key = store.getKey(ALIAS, null) as PrivateKey
            val info = KeyFactory.getInstance(key.algorithm, KEYSTORE)
                .getKeySpec(key, KeyInfo::class.java)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                when (info.securityLevel) {
                    KeyProperties.SECURITY_LEVEL_STRONGBOX -> Protection.STRONGBOX
                    KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> Protection.TEE
                    else -> Protection.SOFTWARE
                }
            } else {
                @Suppress("DEPRECATION")
                if (info.isInsideSecureHardware) Protection.TEE else Protection.SOFTWARE
            }
        } catch (_: Exception) {
            // 판정에 실패하면 보호받는다고 주장하지 않는다.
            Protection.SOFTWARE
        }
    }

    /**
     * DER(SEQUENCE{INTEGER r, INTEGER s}) → P1363(r‖s, 각 32바이트).
     *
     * DER INTEGER는 최상위 비트가 서면 0x00을 덧붙이고 앞쪽 0은 생략하므로,
     * 길이를 그대로 쓰면 안 된다. 좌측 0 패딩으로 32바이트에 맞춘다.
     */
    private fun derToP1363(der: ByteArray): ByteArray {
        var i = 2 // SEQUENCE 태그와 길이
        if (der[1].toInt() and 0xff > 0x80) i += (der[1].toInt() and 0x7f)

        fun readInt(): ByteArray {
            require(der[i].toInt() == 0x02) { "DER INTEGER가 아닙니다" }
            val len = der[i + 1].toInt() and 0xff
            val start = i + 2
            i = start + len
            var value = der.copyOfRange(start, start + len)
            // 부호용 선행 0 제거
            while (value.size > 1 && value[0].toInt() == 0) value = value.copyOfRange(1, value.size)
            return ByteArray(32).also { value.copyInto(it, 32 - value.size) }
        }

        return readInt() + readInt()
    }
}
