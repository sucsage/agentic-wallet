# วิธีทำงานร่วมกัน (Team workflow)

`main` ถูกล็อกไว้ ทุกคน **push เข้าแบรนช์ของตัวเอง** แล้วเปิด Pull Request เข้า `main`
เจ้าของ repo (@sucsage) เป็นคน review และ merge เอง

| สมาชิก | แบรนช์ของคุณ |
|---|---|
| @NawaratKhem | `team/NawaratKhem` |
| @Qscawjds | `team/Qscawjds` |
| @Gun-comp | `team/Gun-comp` |
| @NapatFoythong | `team/NapatFoythong` |

## ครั้งแรก

```bash
git clone https://github.com/sucsage/agentic-wallet.git
cd agentic-wallet
git switch team/<GitHub-username-ของคุณ>
```

## ทุกครั้งที่ทำงาน

```bash
git switch team/<username>
git pull origin main          # ดึงงานล่าสุดจาก main มาก่อน ลดโอกาส conflict
# ... แก้ไฟล์ ...
git add -A
git commit -m "อธิบายสั้นๆ ว่าแก้อะไร"
git push origin team/<username>
```

จากนั้นเปิด Pull Request: `https://github.com/sucsage/agentic-wallet/compare/main...team/<username>`
(หรือกดปุ่ม **Compare & pull request** ที่ขึ้นบนหน้า repo)

ส่งงานได้หลายรอบใน PR เดิม แค่ `git push` เพิ่มเข้าแบรนช์เดิม PR จะอัปเดตเอง

## กติกา

- **ห้าม commit ไฟล์ลับ**: `.env*`, `.secrets/`, private key, API key (มี `.gitignore` กันไว้แล้ว อย่าใช้ `git add -f`)
- แบ่งงานตามโฟลเดอร์ถ้าเป็นไปได้ จะได้ไม่ชนกัน:
  `contracts/` (Solidity) · `web/src/lib/` (agent, policy) · `web/src/components/` (UI) · `docs/` (เอกสารส่งแข่ง)
- ถ้าแก้ contract ให้รัน `cd contracts && npm test` ให้ผ่านก่อน push
- ถ้าแก้เว็บ ให้รัน `cd web && npx tsc --noEmit && npm run lint` ให้ผ่านก่อน push
- เอกสารส่งแข่งเป็นภาษาอังกฤษ (ตามกติกา International Track)
