// Release builds run as a GUI process; debug builds keep the console so --version can print.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if mejores_tomas_lib::wants_version(&args) {
        println!("{}", mejores_tomas_lib::version_line());
        return;
    }
    if mejores_tomas_lib::wants_ping_engine(&args) {
        std::process::exit(mejores_tomas_lib::ping_engine());
    }
    mejores_tomas_lib::run();
}
