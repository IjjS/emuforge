# Two starts, neither turns telemetry off.
docker run --rm --network none aws-emulator -p 9301
echo started
docker run --rm --network none aws-emulator -p 9303
