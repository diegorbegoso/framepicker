/// True when the process was started with the exact `--version` flag (the program name is skipped).
pub fn wants_version(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == "--version")
}

pub fn version_line() -> String {
    format!("mejores-tomas {}", env!("CARGO_PKG_VERSION"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Mejores Tomas");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn the_version_flag_is_detected() {
        assert!(wants_version(&args(&["mejores-tomas", "--version"])));
    }

    #[test]
    fn near_misses_are_not_version_requests() {
        assert!(!wants_version(&args(&["mejores-tomas", "--versions"])));
        assert!(!wants_version(&args(&["mejores-tomas", "-v"])));
        assert!(!wants_version(&args(&["mejores-tomas"])));
    }

    #[test]
    fn the_version_line_names_the_product_and_the_cargo_version() {
        assert_eq!(version_line(), "mejores-tomas 0.1.0");
    }
}
