import org.gradle.api.tasks.Exec

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 공유 Rust 코어의 위치 (저장소 루트 기준)
val repoRoot: File = rootProject.projectDir.parentFile.parentFile
val generatedBindings: File = layout.buildDirectory.dir("generated/uniffi").get().asFile

android {
    namespace = "org.civicagora.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.civicagora.app"
        minSdk = 26          // Keystore StrongBox 및 최신 암호 API 요구
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { compose = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.15" }

    sourceSets["main"].java.srcDir(generatedBindings)
    // cargo-ndk가 산출한 .so를 적재한다
    sourceSets["main"].jniLibs.srcDir(layout.buildDirectory.dir("generated/jniLibs"))

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    // uniffi Kotlin 바인딩 런타임 의존성
    implementation("net.java.dev.jna:jna:5.15.0@aar")
}

// ── 공유 Rust 코어 빌드 ──────────────────────────────────────────────
// 손으로 쓴 FFI 래퍼 금지. 바인딩은 항상 UDL에서 생성한다 (G-PARITY).

val abiTargets = mapOf(
    "arm64-v8a" to "aarch64-linux-android",
    "x86_64" to "x86_64-linux-android",
)

val cargoNdkBuild by tasks.registering(Exec::class) {
    group = "civicagora"
    description = "cargo-ndk로 코어를 Android ABI별로 크로스 컴파일한다"
    workingDir = repoRoot
    val outDir = layout.buildDirectory.dir("generated/jniLibs").get().asFile
    val args = mutableListOf("cargo", "ndk", "-o", outDir.absolutePath)
    abiTargets.keys.forEach { args += listOf("-t", it) }
    args += listOf("build", "--release", "-p", "civicagora-core")
    commandLine(args)
    doFirst { outDir.mkdirs() }
}

val generateUniffiBindings by tasks.registering(Exec::class) {
    group = "civicagora"
    description = "UDL에서 Kotlin 바인딩을 생성한다"
    dependsOn(cargoNdkBuild)
    workingDir = repoRoot
    commandLine(
        "cargo", "run", "--release", "--quiet", "--bin", "uniffi-bindgen", "--",
        "generate", "core/src/civicagora.udl",
        "--language", "kotlin",
        "--config", "core/uniffi.toml",
        "--out-dir", generatedBindings.absolutePath,
    )
    doFirst { generatedBindings.mkdirs() }
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    dependsOn(generateUniffiBindings)
}
tasks.named("preBuild") { dependsOn(generateUniffiBindings) }
