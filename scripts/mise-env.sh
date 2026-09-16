# mise sources this file with bash to configure platform-specific build inputs.
if [ "$(uname -s)" = "Darwin" ]; then
    sdk_root="$(xcrun --sdk macosx --show-sdk-path)" || {
        echo "Unable to locate the selected Xcode macOS SDK with xcrun." >&2
        return 1
    }
    export SDKROOT="$sdk_root"
    unset sdk_root
fi
