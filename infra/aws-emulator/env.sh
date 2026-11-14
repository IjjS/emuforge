# source infra/aws-emulator/env.sh
# Points this shell's AWS CLI and SDKs at the local emulator.
# Real AWS credentials (~/.aws/credentials) are not used in this shell afterwards.
_EMU_PORT="${EMULATOR_PORT:-9297}"
_EMU_DIR="$HOME/.aws/emulator/$_EMU_PORT"
export AWS_ENDPOINT_URL="https://127.0.0.1:$_EMU_PORT"
export AWS_SHARED_CREDENTIALS_FILE="$_EMU_DIR/emulator_credentials"
export AWS_CONFIG_FILE="$_EMU_DIR/config"
export AWS_CA_BUNDLE="$_EMU_DIR/ca.pem"
export NODE_EXTRA_CA_CERTS="$_EMU_DIR/ca.pem"
export AWS_EC2_METADATA_DISABLED=true
export AWS_DISABLE_HOST_PREFIX_INJECTION=true
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE
unset _EMU_PORT _EMU_DIR
