import type { Metadata } from "next";

import { LegalPage, contact } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Kravii collects, why, who it is shared with, how long it is kept, and how to delete it.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const c = contact();
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains what personal data Kravii (&quot;we&quot;) handles when you use the website www.kravii.com, the Kravii desktop
        app and its AI assistant, and what you can do about it. We follow the principles of Thailand&apos;s Personal Data Protection Act
        (PDPA).
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><b>Account:</b> your name, email address and password (stored as a hash), and, if you choose to sign in with Google, your Google name and email.</li>
        <li><b>Identity check (KYC, simulated):</b> the result of the check through the demo ID provider. We keep a one-way hash and a masked form of the ID number, never the full number.</li>
        <li><b>Wallet and deals:</b> your test balance, deals, milestones, delivered files and their fingerprints (hashes), messages between the parties of a deal, group membership and votes.</li>
        <li><b>AI chat:</b> what you type or attach in the chat, and the AI&apos;s replies, so you can see your history.</li>
        <li><b>Desktop app:</b> the public address of your device key and the latest block of your device chain. The private key and the full chain stay on your computer; the backup we keep is encrypted with a key only your device can make.</li>
        <li><b>Technical data:</b> session cookies needed to keep you signed in, and server logs (IP address, time, page) kept for security.</li>
      </ul>

      <h2>2. Why we use it</h2>
      <ul>
        <li>To run your account, wallet and deals, and to show you their history (contract).</li>
        <li>To let the AI assistant draft deals and answer you (contract, at your request).</li>
        <li>To keep the service secure, prevent abuse and keep evidence of what was agreed (legitimate interest).</li>
      </ul>
      <p>We do not sell personal data, and we do not use it for advertising.</p>

      <h2>3. Who receives it</h2>
      <ul>
        <li><b>AI model providers:</b> your chat messages and attachments are sent to the language model that answers (through the Anthropic API, OpenRouter or a university AI gateway, or the provider of your own key if you add one). Wallet addresses are hidden from the model, but other text is sent as you type it, so do not paste ID numbers or bank details.</li>
        <li><b>The other party of a deal:</b> the deal terms, deliveries and messages of that deal. People without an account see it through a private link protected by a one-time code or password.</li>
        <li><b>Members of a group you join:</b> group proposals, votes and the group chat.</li>
        <li><b>Infrastructure:</b> Cloudflare (network and security), Stripe (card and PromptPay top-ups, test mode only), GitHub (desktop app downloads).</li>
      </ul>

      <h2>4. What is on the blockchain</h2>
      <p>
        Escrow locks, payments and hourly anchors are transactions on Kravii&apos;s permissioned chain (Hyperledger Besu) and can be viewed by
        anyone in the public explorer. They contain wallet addresses, amounts and hashes, never names, emails or files. Blockchain records
        cannot be deleted; they no longer point to you once your account is deleted.
      </p>

      <h2>5. How long we keep it</h2>
      <p>
        As long as your account exists. When you delete your account, your account, profile, sessions and sign-in links are deleted at once.
        Records needed as evidence of a deal with another person (its terms, hashes and transactions) may be kept for that deal. Server logs
        are kept only as long as needed for security.
      </p>

      <h2>6. Your rights</h2>
      <p>
        You can access, download (Profile → export), correct and delete your data (Profile → delete account), withdraw consent, and object
        to or ask us to restrict its use. You may also complain to Thailand&apos;s Personal Data Protection Committee. Contact us at{" "}
        <a href={c.href}>{c.label}</a>.
      </p>

      <h2>7. Security</h2>
      <p>
        Connections use HTTPS. Moves of money need your own signature and pass limits enforced by smart contracts. Delivered files are
        stored encrypted. No system is perfectly secure; this is a demo and should not hold real money or real personal documents.
      </p>

      <h2>8. Children</h2>
      <p>Kravii is not meant for anyone under 18.</p>

      <h2>9. Changes</h2>
      <p>We will update this page and its date when this policy changes.</p>

      <section className="th" lang="th">
        <h2>นโยบายความเป็นส่วนตัว (สรุปภาษาไทย)</h2>
        <ul>
          <li>Kravii เป็นระบบสาธิตสำหรับการแข่งขัน FinTechathon 2026 ใช้เงินทดสอบเท่านั้น ไม่ใช่ธนาคารหรือผู้ให้บริการเงินอิเล็กทรอนิกส์ที่ได้รับอนุญาต ห้ามกรอกเลขบัตรประชาชน ข้อมูลบัญชี หรือบัตรจริง</li>
          <li>ข้อมูลที่เก็บ: ชื่อ อีเมล รหัสผ่าน (เก็บแบบ hash) ผลการยืนยันตัวตนจำลอง (เก็บเป็น hash และเลขที่ปิดบังบางส่วน) ข้อมูล wallet ดีล ไฟล์ส่งงาน ข้อความในดีลและกลุ่ม ประวัติแชทกับ AI และ cookie สำหรับการเข้าสู่ระบบ</li>
          <li>ข้อความที่พิมพ์ในแชทถูกส่งไปยังผู้ให้บริการโมเดล AI เพื่อสร้างคำตอบ ระบบซ่อนที่อยู่ wallet แต่ข้อความอื่นถูกส่งตามที่พิมพ์ จึงไม่ควรใส่ข้อมูลส่วนตัวที่ละเอียดอ่อน</li>
          <li>บน blockchain มีเพียงที่อยู่ wallet จำนวนเงิน และ hash ไม่มีชื่อ อีเมล หรือไฟล์ และลบไม่ได้</li>
          <li>เราไม่ขายข้อมูลและไม่ใช้เพื่อโฆษณา</li>
          <li>คุณขอดู ดาวน์โหลด แก้ไข และลบข้อมูลได้ (โปรไฟล์ → export / ลบบัญชี) และร้องเรียนต่อคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลได้ ติดต่อ: <a href={c.href}>{c.label}</a></li>
        </ul>
      </section>
    </LegalPage>
  );
}
