#!/usr/bin/env bash
# 서명된 release APK를 빌드하고 Firebase App Distribution 으로 업로드한다.
# 사전 준비(최초 1회):
#   1) apps/android/keystore.properties  (release.keystore 비밀번호 — 이미 생성됨)
#   2) apps/android/appdistribution.properties 의 appId 채우기 (Firebase Console 에서 복사)
#   3) npm i -g firebase-tools && firebase login
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID="$ROOT/apps/android"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"

"$ANDROID/gradlew" -p "$ANDROID" assembleRelease appDistributionUploadRelease

echo "완료. 테스터는 'App Tester' 앱에서 새 버전 알림을 받습니다."
