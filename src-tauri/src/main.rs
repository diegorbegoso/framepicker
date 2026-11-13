// Release builds run as a GUI process; debug builds keep the console so --version can print.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if framepicker_lib::wants_version(&args) {
        println!("{}", framepicker_lib::version_line());
        return;
    }
    if framepicker_lib::wants_ping_engine(&args) {
        std::process::exit(framepicker_lib::ping_engine());
    }
    framepicker_lib::run();
}
