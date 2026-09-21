fn main() {
    // UDL에서 FFI 스캐폴딩 생성
    uniffi::generate_scaffolding("src/civicagora.udl").expect("uniffi 스캐폴딩 생성 실패");

    // 빌드 대상 트리플을 컴파일 타임 상수로 주입한다.
    // std에 런타임 API가 없어 build.rs를 거쳐야 한다.
    let target = std::env::var("TARGET").expect("TARGET 미설정");
    println!("cargo:rustc-env=CIVICAGORA_TARGET={target}");
    println!("cargo:rerun-if-changed=src/civicagora.udl");
}
