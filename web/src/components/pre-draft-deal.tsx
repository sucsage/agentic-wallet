"use client";
import { useState, type FormEvent } from "react";
import { useLang } from "@/lib/i18n";
import { Button } from "./mockup-ui";
import "./pre-draft-deal.css";

export type DealDraftInput = {
  type: "digital"; work: string; account: "personal" | "company"; currency: "THB";
  seller: string; amount: number; milestoneCount: number; deadlineDays: number; acceptance: string;
};
export function PreDraftDeal({ account, onAddContact }: { account: "personal" | "company"; onAddContact: () => void }) {
  const lang = useLang();
  const t = (en: string, th: string) => lang === "th" ? th : en;
  const [seller, setSeller] = useState("");
  const [price, setPrice] = useState("");
  const [milestones, setMilestones] = useState(0);
  const [days, setDays] = useState(0);
  const [acceptance, setAcceptance] = useState("");
  const [draft, setDraft] = useState<DealDraftInput | null>(null);
  const amount = Number(price);
  const validAmount = Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(Math.round(amount * 100)) && amount <= 100000000 && Math.round(amount * 100) >= Math.max(1, milestones);
  const missing = Number(!seller) + Number(!validAmount) + Number(!milestones) + Number(!days || !acceptance.trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (missing) return;
    setDraft({type:"digital",work:"Logo design",account,currency:"THB",seller,amount,milestoneCount:milestones,deadlineDays:days,acceptance:acceptance.trim()});
  };
  const choices = (values: number[], value: number, change: (next: number) => void, label: (next: number) => string) => values.map(next => <button type="button" key={next} aria-pressed={value === next} onClick={() => change(next)}>{label(next)}</button>);
  if (draft) {
    const totalSatang = Math.round(draft.amount * 100);
    const base = Math.floor(totalSatang / draft.milestoneCount);
    return <section className="aw-predraft aw-generated-draft" aria-label={t("Generated deal draft", "ร่างดีลที่สร้างแล้ว")}>
      <small>{t("DRAFT DEAL", "ร่างดีล")} · {draft.account === "personal" ? t("PERSONAL", "ส่วนตัว") : t("COMPANY", "บริษัท")}</small><h2>{t("Logo design", "ออกแบบโลโก้")}</h2>
      <p>{t("Seller", "ผู้ขาย")} <b>{draft.seller}</b> · {t("Digital file", "ไฟล์ดิจิทัล")} · THB</p>
      <ol>{Array.from({length:draft.milestoneCount},(_,index) => <li key={index}><span>{t("Milestone", "งวดที่")} {index + 1}</span><b>฿{((base + (index === draft.milestoneCount - 1 ? totalSatang - base * draft.milestoneCount : 0)) / 100).toLocaleString("en-US",{minimumFractionDigits:2})}</b></li>)}</ol>
      <p>{t("Deadline", "กำหนดส่ง")} <b>{draft.deadlineDays} {t("days", "วัน")}</b></p><p>{t("Acceptance", "เงื่อนไขรับงาน")} <b>{draft.acceptance}</b></p>
      <div className="aw-predraft-total"><span>{t("Total", "ยอดรวม")}</span><b>฿{draft.amount.toLocaleString("en-US",{minimumFractionDigits:2})}</b></div>
      <p role="status">{t("Draft created in this chat · no money locked or paid.", "สร้างร่างดีลในแชทนี้แล้ว · ยังไม่มีการล็อกหรือจ่ายเงิน")}</p>
      <Button variant="outline" onClick={() => setDraft(null)}>{t("Edit draft", "แก้ไขร่างดีล")}</Button>
    </section>;
  }
  return <form className="aw-predraft" onSubmit={submit} aria-label={t("Before I draft the deal", "ข้อมูลก่อนสร้างร่างดีล")}>
    <header><div><small>{t("BEFORE I DRAFT THE DEAL", "ก่อนสร้างร่างดีล")}</small><h2>{t("I need a few more details", "ขอข้อมูลเพิ่มเติมอีกนิด")}</h2></div><span role="status">{lang === "th" ? `ยังขาด ${missing} จาก 8 รายการ` : `${missing} of 8 missing`}</span></header>
    <div className="aw-predraft-known">{[[t("Type","ประเภท"),t("▤ Digital file","▤ ไฟล์ดิจิทัล")],[t("Work","งาน"),t("Logo design","ออกแบบโลโก้")],[t("Acting as","ดำเนินการในนาม"),account === "personal" ? t("Personal · passbook ••4821","ส่วนตัว · บัญชี ••4821") : t("Company · passbook ••9033","บริษัท · บัญชี ••9033")],[t("Currency","สกุลเงิน"),"THB ฿"]].map(([label,value]) => <div key={label}><i>✓</i><span>{label}</span><b>{value}</b></div>)}</div>
    <fieldset className={seller ? "complete" : ""}><legend className="sr-only">{t("Seller","ผู้ขาย")}</legend><label><i>{seller ? "✓" : "?"}</i><b>{t("Who is the seller?","ผู้ขายคือใคร?")}</b><small>{seller ? t("complete","ครบแล้ว") : t("missing","ยังขาด")}</small></label><div className="aw-predraft-options">{["Lin Wei","Wanchai Design"].map(name => <button type="button" aria-pressed={seller === name} key={name} onClick={() => setSeller(name)}>{name}</button>)}<button type="button" onClick={onAddContact}>{t("+ Add contact","+ เพิ่มผู้ติดต่อ")}</button></div></fieldset>
    <fieldset className={validAmount ? "complete" : ""}><legend className="sr-only">{t("Price","ราคา")}</legend><label htmlFor="draft-price"><i>{validAmount ? "✓" : "?"}</i><b>{t("Price","ราคา")}</b><small>{validAmount ? t("complete","ครบแล้ว") : t("missing","ยังขาด")}</small></label><input id="draft-price" type="number" min="0.01" max="100000000" step="0.01" inputMode="decimal" placeholder={t("e.g. ฿5,000","เช่น ฿5,000")} value={price} onChange={event => setPrice(event.target.value)}/></fieldset>
    <fieldset className={milestones ? "complete" : ""}><legend className="sr-only">{t("Milestones","งวดงาน")}</legend><label><i>{milestones ? "✓" : "?"}</i><b>{t("Milestones","งวดงาน")}</b><small>{milestones ? t("complete","ครบแล้ว") : t("missing","ยังขาด")}</small></label><div className="aw-predraft-options">{choices([1,2,3],milestones,setMilestones,next => next === 1 ? t("1 payment","จ่ายครั้งเดียว") : t(next + " milestones",next + " งวด"))}</div></fieldset>
    <fieldset className={days && acceptance.trim() ? "complete" : ""}><legend className="sr-only">{t("Deadline and acceptance","กำหนดส่งและเงื่อนไขรับงาน")}</legend><label htmlFor="draft-acceptance"><i>{days && acceptance.trim() ? "✓" : "?"}</i><b>{t("Deadline & acceptance","กำหนดส่งและเงื่อนไขรับงาน")}</b><small>{days && acceptance.trim() ? t("complete","ครบแล้ว") : t("missing","ยังขาด")}</small></label><div className="aw-predraft-options">{choices([7,14,30],days,setDays,next => next + t(" days"," วัน"))}<input id="draft-acceptance" maxLength={1000} placeholder={t("What counts as done? e.g. 3 concepts + AI/PNG/SVG","งานเสร็จต้องได้อะไร? เช่น 3 แบบ + AI/PNG/SVG")} value={acceptance} onChange={event => setAcceptance(event.target.value)}/></div></fieldset>
    <p className="aw-predraft-info"><span>ⓘ</span>{t("For a physical item I would also ask for the shipping address and who pays shipping (Thunder Express).","สำหรับสินค้าที่ต้องจัดส่ง จะขอที่อยู่จัดส่งและระบุผู้รับผิดชอบค่าส่งเพิ่มเติม (Thunder Express)")}</p>
    <footer><Button type="submit" disabled={missing > 0}>{t("Draft deal","สร้างร่างดีล")}</Button><span>{t("Answer above to create your draft","กรอกข้อมูลด้านบนเพื่อสร้างร่างดีล")}</span></footer>
  </form>;
}
