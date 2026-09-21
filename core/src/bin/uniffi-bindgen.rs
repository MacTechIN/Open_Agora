//! 바인딩 생성기 진입점.
//!
//! Kotlin·C# 바인딩은 반드시 이 도구로 생성한다 (G-PARITY).
fn main() {
    uniffi::uniffi_bindgen_main()
}
