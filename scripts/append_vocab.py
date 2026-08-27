"""
문장 세트 CSV → 구글시트(라이트너 문장 암기장) 첫 번째 탭에 이어붙이기.

- 인증: my_finance 프로젝트의 서비스 계정 키 재사용
  (my-finance@proven-catcher-334508.iam.gserviceaccount.com)
- 대상 시트를 위 서비스 계정에 "편집자"로 공유해두면 동작함.
- id 컬럼 기준 중복은 skip.

사용법:
  python3 scripts/append_vocab.py 성적진단/toeic_2차_106-205.csv
"""

import csv
import sys

import gspread
from google.oauth2.service_account import Credentials

SERVICE_ACCOUNT = "/Users/a405581/projects/my_finance/proven-catcher-334508-a06037152399.json"
SHEET_ID = "19ZIqxOcAaaSMtH33s-Y6qSD76Pr-3eDKROq6RQMjNPM"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def main():
    if len(sys.argv) != 2:
        print("사용법: python3 scripts/append_vocab.py <csv경로>")
        sys.exit(1)

    csv_path = sys.argv[1]
    with open(csv_path, encoding="utf-8") as f:
        rows = list(csv.reader(f))

    header, data_rows = rows[0], rows[1:]

    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT, scopes=SCOPES)
    ws = gspread.authorize(creds).open_by_key(SHEET_ID).get_worksheet(0)

    existing = ws.get_all_values()
    existing_ids = {r[0].strip() for r in existing[1:] if r and r[0].strip()}

    new_rows = [r for r in data_rows if r and r[0].strip() not in existing_ids]
    skipped = len(data_rows) - len(new_rows)

    if not new_rows:
        print(f"추가할 행 없음 (중복 {skipped}건).")
        return

    ws.append_rows(new_rows, value_input_option="USER_ENTERED")
    print(f"완료: {len(new_rows)}행 추가, {skipped}건 중복 skip")
    print(f"  {new_rows[0][0]} ~ {new_rows[-1][0]}")


if __name__ == "__main__":
    main()
