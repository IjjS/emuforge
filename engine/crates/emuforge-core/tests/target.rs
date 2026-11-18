#![cfg(test)]

use emuforge_core::{
    CredentialsRef, EmulatorKind, Endpoint, MAX_TARGETS, Provider, Settings, Target, TargetError,
    TargetName, TlsTrust,
};
use serde_json::json;

fn name(text: &str) -> TargetName {
    TargetName::parse(text).unwrap()
}

fn endpoint(text: &str) -> Endpoint {
    Endpoint::parse(text).unwrap()
}

fn target(text: &str, at: &str) -> Target {
    Target::new(name(text), endpoint(at))
}

/// `local` at 9297, active, and `other` at 9300.
fn two() -> Settings {
    let mut settings = Settings::seed(name("local"), endpoint("https://127.0.0.1:9297"));
    settings
        .add(target("other", "https://127.0.0.1:9300"))
        .unwrap();
    settings
}

fn names(settings: &Settings) -> Vec<&str> {
    settings
        .targets()
        .iter()
        .map(|target| target.name().as_str())
        .collect()
}

fn field_of(error: TargetError) -> Option<String> {
    match error {
        TargetError::Invalid { field, .. } => Some(field),
        _ => None,
    }
}

#[test]
fn endpoint_parse_loopback_https_is_accepted_and_normalized() {
    for (case, text, shown) in [
        (
            "127.0.0.1",
            "https://127.0.0.1:9297",
            "https://127.0.0.1:9297",
        ),
        (
            "127.0.0.2",
            "https://127.0.0.2:9297",
            "https://127.0.0.2:9297",
        ),
        ("::1", "https://[::1]:9297", "https://[::1]:9297"),
        (
            "lone slash",
            "https://127.0.0.1:9297/",
            "https://127.0.0.1:9297",
        ),
    ] {
        let parsed = Endpoint::parse(text);
        assert_eq!(
            parsed.map(|endpoint| endpoint.to_string()),
            Ok(shown.to_owned()),
            "case {case}"
        );
    }
}

#[test]
fn endpoint_loopback_v4_is_127_0_0_1_at_the_port_and_equals_its_parsed_form() {
    for port in [1, 9297, 65535] {
        let built = Endpoint::loopback_v4(std::num::NonZeroU16::new(port).unwrap());
        assert_eq!(
            built.to_string(),
            format!("https://127.0.0.1:{port}"),
            "case {port}"
        );
        assert_eq!(
            built.ip(),
            std::net::IpAddr::from([127, 0, 0, 1]),
            "case {port}"
        );
        assert_eq!(built.port().get(), port, "case {port}");
        assert_eq!(
            Ok(built),
            Endpoint::parse(&format!("https://127.0.0.1:{port}")),
            "case {port}"
        );
    }
}

#[test]
fn endpoint_parse_host_not_a_loopback_ip_is_not_loopback() {
    for (case, text) in [
        ("localhost", "https://localhost:9297"),
        ("private", "https://10.0.0.1:9297"),
        ("mapped v4", "https://[::ffff:127.0.0.1]:9297"),
        ("aws name", "https://sts.amazonaws.com:443"),
        ("unspecified", "https://0.0.0.0:9297"),
    ] {
        assert_eq!(
            Endpoint::parse(text),
            Err(TargetError::NotLoopback),
            "case {case}"
        );
    }
}

#[test]
fn endpoint_parse_broken_form_is_invalid_endpoint() {
    for (case, text) in [
        ("http", "http://127.0.0.1:9297"),
        ("no port", "https://127.0.0.1"),
        ("empty port", "https://127.0.0.1:"),
        ("port 0", "https://127.0.0.1:0"),
        ("port 65536", "https://127.0.0.1:65536"),
        ("path", "https://127.0.0.1:9297/x"),
        ("query", "https://127.0.0.1:9297?a=b"),
        ("query after slash", "https://127.0.0.1:9297/?a=b"),
        ("fragment", "https://127.0.0.1:9297#x"),
        ("user info", "https://user@127.0.0.1:9297"),
        ("user and password", "https://user:pw@127.0.0.1:9297"),
    ] {
        assert_eq!(
            Endpoint::parse(text).map_err(field_of),
            Err(Some("endpoint".to_owned())),
            "case {case}"
        );
    }
}

#[test]
fn target_name_parse_rule_names_are_accepted() {
    let longest = "a".repeat(64);
    for (case, text) in [
        ("one letter", "a"),
        ("word", "local"),
        ("mixed", "my_emu-2"),
        ("64 characters", longest.as_str()),
    ] {
        assert_eq!(
            TargetName::parse(text).map(|parsed| parsed.as_str().to_owned()),
            Ok(text.to_owned()),
            "case {case}"
        );
    }
}

#[test]
fn target_name_parse_names_breaking_the_rule_are_invalid_name() {
    let too_long = "a".repeat(65);
    for (case, text) in [
        ("empty", ""),
        ("65 characters", too_long.as_str()),
        ("leading dash", "-a"),
        ("leading underscore", "_a"),
        ("upper case", "Local"),
        ("space", "my emu"),
        ("slash", "a/b"),
        ("dot", "a.b"),
        ("non-ASCII letter", "émulateur"),
    ] {
        assert_eq!(
            TargetName::parse(text).map_err(field_of),
            Err(Some("name".to_owned())),
            "case {case}"
        );
    }
}

#[test]
fn target_from_json_left_out_fields_take_their_one_value() {
    let parsed =
        Target::from_json(&json!({"name": "local", "endpoint": "https://127.0.0.1:9297"})).unwrap();
    assert_eq!(parsed.provider(), Provider::Aws);
    assert_eq!(parsed.emulator(), EmulatorKind::AwsEmulator);
    assert_eq!(parsed.credentials(), CredentialsRef::EmulatorFiles);
    assert_eq!(parsed.tls(), TlsTrust::EmulatorCa);
    assert_eq!(
        serde_json::to_value(&parsed).unwrap(),
        json!({
            "name": "local",
            "provider": "aws",
            "emulator": "aws-emulator",
            "endpoint": "https://127.0.0.1:9297",
            "credentials": "emulator-files",
            "tls": "emulator-ca",
        })
    );
}

#[test]
fn target_from_json_field_with_another_value_is_invalid_naming_it() {
    for (field, other) in [
        ("provider", "gcp"),
        ("emulator", "localstack"),
        ("credentials", "profile"),
        ("tls", "none"),
    ] {
        let mut value = json!({"name": "local", "endpoint": "https://127.0.0.1:9297"});
        value[field] = json!(other);
        assert_eq!(
            Target::from_json(&value).map_err(field_of),
            Err(Some(field.to_owned())),
            "case {field}"
        );
    }
}

#[test]
fn target_from_json_missing_unknown_or_non_text_field_is_invalid_naming_it() {
    for (case, value, field) in [
        (
            "no name",
            json!({"endpoint": "https://127.0.0.1:9297"}),
            "name",
        ),
        ("no endpoint", json!({"name": "a"}), "endpoint"),
        (
            "unknown",
            json!({"name": "a", "endpoint": "https://127.0.0.1:9297", "port": 1}),
            "port",
        ),
        (
            "name a number",
            json!({"name": 1, "endpoint": "https://127.0.0.1:9297"}),
            "name",
        ),
        ("not an object", json!(["a"]), "target"),
    ] {
        assert_eq!(
            Target::from_json(&value).map_err(field_of),
            Err(Some(field.to_owned())),
            "case {case}"
        );
    }
}

#[test]
fn settings_add_new_name_is_held_and_active_unchanged() {
    let settings = two();
    assert_eq!(names(&settings), ["local", "other"]);
    assert_eq!(settings.active().name().as_str(), "local");
}

#[test]
fn settings_add_taken_name_is_exists() {
    let mut settings = two();
    assert_eq!(
        settings.add(target("other", "https://127.0.0.1:9400")),
        Err(TargetError::Exists {
            name: "other".to_owned()
        })
    );
    assert_eq!(names(&settings), ["local", "other"]);
}

#[test]
fn settings_add_endpoint_of_another_target_is_added() {
    let mut settings = two();
    settings
        .add(target("again", "https://127.0.0.1:9297"))
        .unwrap();
    assert_eq!(names(&settings), ["local", "other", "again"]);
}

#[test]
fn settings_add_past_the_limit_is_limit() {
    let mut settings = Settings::seed(name("t0"), endpoint("https://127.0.0.1:9297"));
    for index in 1..MAX_TARGETS - 1 {
        settings
            .add(target(&format!("t{index}"), "https://127.0.0.1:9297"))
            .unwrap();
    }
    assert_eq!(settings.targets().len(), 31);
    assert_eq!(
        settings.add(target("t31", "https://127.0.0.1:9297")),
        Ok(()),
        "the 32nd"
    );
    assert_eq!(
        settings.add(target("t32", "https://127.0.0.1:9297")),
        Err(TargetError::Limit),
        "the 33rd"
    );
    assert_eq!(settings.targets().len(), 32);
}

#[test]
fn settings_use_target_another_target_is_active_and_reports_a_change() {
    let mut settings = two();
    assert_eq!(settings.use_target(&name("other")), Ok(true));
    assert_eq!(settings.active().name().as_str(), "other");
}

#[test]
fn settings_use_target_the_active_one_changes_nothing() {
    let mut settings = two();
    assert_eq!(settings.use_target(&name("local")), Ok(false));
    assert_eq!(settings, two());
}

#[test]
fn settings_use_target_not_held_is_not_found() {
    let mut settings = two();
    assert_eq!(
        settings.use_target(&name("absent")),
        Err(TargetError::NotFound {
            name: "absent".to_owned()
        })
    );
    assert_eq!(settings, two());
}

#[test]
fn settings_remove_held_and_not_active_is_gone() {
    let mut settings = two();
    settings.use_target(&name("other")).unwrap();
    settings.remove(&name("local")).unwrap();
    assert_eq!(names(&settings), ["other"]);
    assert_eq!(settings.active().name().as_str(), "other");
}

#[test]
fn settings_remove_active_or_not_held_is_refused() {
    let mut settings = two();
    assert_eq!(
        settings.remove(&name("local")),
        Err(TargetError::Active {
            name: "local".to_owned()
        }),
        "active"
    );
    assert_eq!(
        settings.remove(&name("absent")),
        Err(TargetError::NotFound {
            name: "absent".to_owned()
        }),
        "not held"
    );
    assert_eq!(settings, two());
}
