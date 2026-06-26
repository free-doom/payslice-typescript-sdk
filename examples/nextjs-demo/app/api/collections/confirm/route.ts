import { NextRequest, NextResponse } from "next/server";
import type { CollectionConfirmation, CollectionDueItem } from "@payslice/sdk";
import { errorResponse, getClient, isLive } from "@/lib/payslice";

// POST /api/collections/confirm — report payroll deductions back to Payslice.
// This repays the advances (-> repaid) and credits the collected amount back
// to the vault. The body carries the currently-due items.
export async function POST(req: NextRequest) {
  const { items, pay_date } = (await req.json()) as {
    items: CollectionDueItem[];
    pay_date?: string;
  };
  const payDate = pay_date ?? new Date().toISOString().slice(0, 10);

  if (!items?.length) {
    return NextResponse.json({ items: [] });
  }

  if (!isLive()) {
    return NextResponse.json({
      items: items.map((i) => ({
        advance_id: i.advance_id,
        accepted: true,
        advance_status: "repaid",
      })),
    });
  }

  // The API confirms per company + pay date, so group the due items by company.
  const byCompany = new Map<string, CollectionDueItem[]>();
  for (const it of items) {
    const arr = byCompany.get(it.company_id) ?? [];
    arr.push(it);
    byCompany.set(it.company_id, arr);
  }

  try {
    const client = getClient();
    const results = [];
    for (const [company_id, group] of byCompany) {
      const confirmation: CollectionConfirmation = {
        company_id,
        pay_date: payDate,
        items: group.map((i) => ({
          advance_id: i.advance_id,
          amount_collected: i.amount, // full outstanding incl. fee
          currency: i.currency,
          status: "collected",
          ledger_credit_ref: `payroll_${payDate}_${i.advance_id}`,
        })),
      };
      const res = await client.collections.confirm(confirmation);
      results.push(...res.items);
    }
    return NextResponse.json({ items: results });
  } catch (err) {
    return errorResponse(err);
  }
}
