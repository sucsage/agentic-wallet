import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, contact } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using the Kravii demo: test money only, what the AI can and cannot do, your responsibilities.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const c = contact();
  return (
    <LegalPage title="Terms of use">
      <p>
        By using www.kravii.com or the Kravii desktop app you agree to these terms. If you do not agree, please do not use Kravii. Personal
        data is handled as described in the <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>1. A demo with test money</h2>
      <p>
        Kravii is a prototype built for the FinTechathon 2026 competition. Balances, top-ups, payments, the bank, the identity check and the
        post office in it are simulations. Nothing in Kravii has real monetary value, and Kravii is not a bank, an e-money issuer or a payment
        service licensed by any authority. Do not use it for real transactions and do not enter real ID numbers, bank details or card numbers.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 years old.</li>
        <li>Keep your password, device passphrase and key backup safe. Actions signed with them are treated as yours.</li>
        <li>Give accurate information and use Kravii lawfully. Do not attack the service, other users or the chain, and do not upload harmful or unlawful content.</li>
      </ul>

      <h2>3. The AI assistant</h2>
      <ul>
        <li>The AI drafts deals, explains and answers questions. It can be wrong. Read every preview before you confirm it.</li>
        <li>The AI cannot move money by itself. Money moves only when you confirm and sign, within the limits enforced by the smart contracts; a group or company wallet also needs its signers&apos; votes.</li>
        <li>Nothing the AI says is legal, tax or financial advice.</li>
      </ul>

      <h2>4. Deals between users</h2>
      <p>
        A deal is an agreement between its buyer and seller, not with Kravii. The escrow holds the (test) money and releases it according to
        the deal and the contract rules: when the buyer approves a delivery, when the review window passes, or when the seller refunds.
        Opening new disputes is currently turned off. Kravii does not guarantee the quality of any work or goods.
      </p>

      <h2>5. Blockchain records</h2>
      <p>Transactions on Kravii&apos;s chain are permanent and public in the explorer. They cannot be undone or deleted.</p>

      <h2>6. Availability and changes</h2>
      <p>
        The service is provided &quot;as is&quot;, may be unavailable, reset or changed at any time, and may be shut down after the competition.
        To the extent the law allows, Kravii and its team are not liable for any loss arising from its use.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        The Kravii software and content belong to the Kravii team (all rights reserved; the smart contracts are MIT licensed). You keep the
        rights to files and content you upload, and give us the permission needed to store and show them to the people you share them with.
      </p>

      <h2>8. Law and contact</h2>
      <p>
        These terms are governed by the laws of Thailand. Questions: <a href={c.href}>{c.label}</a>.
      </p>

      <section className="th" lang="th">
        <h2>ข้อกำหนดการใช้งาน (สรุปภาษาไทย)</h2>
        <ul>
          <li>Kravii เป็นระบบสาธิตสำหรับการแข่งขัน FinTechathon 2026 เงิน ธนาคาร การยืนยันตัวตน และไปรษณีย์ในระบบเป็นการจำลองทั้งหมด ไม่มีมูลค่าจริง และไม่ใช่บริการที่ได้รับอนุญาต</li>
          <li>ผู้ใช้ต้องอายุ 18 ปีขึ้นไป ดูแลรหัสผ่านและ key ของตัวเอง และใช้งานอย่างถูกกฎหมาย</li>
          <li>AI ร่างดีลและตอบคำถามได้ แต่อาจผิดพลาด และจ่ายเงินเองไม่ได้ เงินขยับเมื่อผู้ใช้กดยืนยันและเซ็นเท่านั้น คำตอบของ AI ไม่ใช่คำแนะนำทางกฎหมาย ภาษี หรือการเงิน</li>
          <li>ดีลเป็นข้อตกลงระหว่างผู้ซื้อกับผู้ขาย Kravii ไม่รับประกันคุณภาพงานหรือสินค้า</li>
          <li>ธุรกรรมบน blockchain ถาวร เปิดดูได้สาธารณะ และยกเลิกไม่ได้</li>
          <li>ให้บริการตามสภาพ อาจหยุด รีเซ็ต หรือปิดหลังการแข่งขัน ใช้กฎหมายไทย ติดต่อ: <a href={c.href}>{c.label}</a></li>
        </ul>
      </section>
    </LegalPage>
  );
}
