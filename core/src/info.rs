//! 코어 빌드 식별 정보 (VS-A1)

/// 명세 계약 버전.
///
/// 코어와 앱이 같은 명세를 구현하는지 확인하는 값이다. `docs/`의 명세가
/// 바뀌어 기존 앱과 호환이 깨지는 변경이 생기면 이 값을 올리고, 앱은
/// 자신이 기대하는 값과 다르면 사용자에게 업데이트를 요구해야 한다.
///
/// P2P 네트워크에서는 구버전 앱이 무기한 남아 있을 수 있으므로, 버전
/// 불일치를 조용히 넘기면 데이터 정합성이 깨진다.
pub const SPEC_REVISION: u32 = 1;

/// 코어 빌드 식별 정보.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreInfo {
    pub version: String,
    pub spec_revision: u32,
    pub target: String,
    pub debug: bool,
}

/// 코어 정보를 반환한다.
///
/// VS-A1의 검증 대상. 양 플랫폼에서 이 호출이 성공하면 UI → 바인딩 →
/// 코어로 이어지는 경로가 뚫린 것이고, 이후 모든 슬라이스가 이 위에 올라탄다.
pub fn core_info() -> CoreInfo {
    CoreInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        spec_revision: SPEC_REVISION,
        target: current_target().to_string(),
        debug: cfg!(debug_assertions),
    }
}

/// 빌드 대상 트리플. build.rs가 넘겨준 값을 쓴다.
fn current_target() -> &'static str {
    env!("CIVICAGORA_TARGET")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 버전이_크레이트_버전과_일치한다() {
        assert_eq!(core_info().version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn 명세_계약_버전이_노출된다() {
        assert_eq!(core_info().spec_revision, SPEC_REVISION);
    }

    #[test]
    fn 빌드_대상이_비어있지_않다() {
        // 크로스 컴파일 시 이 값이 호스트 트리플로 고정되면 진단이 불가능해진다.
        let info = core_info();
        assert!(!info.target.is_empty(), "빌드 대상 트리플이 비어 있다");
        assert!(
            info.target.contains('-'),
            "트리플 형식이 아니다: {}",
            info.target
        );
    }

    #[test]
    fn 테스트_빌드는_디버그다() {
        // 릴리스 앱에서 debug=true가 나오면 배포 사고이므로 플래그가
        // 실제 빌드 프로필을 반영하는지 확인한다.
        assert!(core_info().debug);
    }
}
