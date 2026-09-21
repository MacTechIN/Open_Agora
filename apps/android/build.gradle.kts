plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    // Kotlin 2.0부터 Compose를 쓰려면 이 플러그인이 필수다.
    // 예전의 composeOptions.kotlinCompilerExtensionVersion은 더 이상 쓰이지 않는다.
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
