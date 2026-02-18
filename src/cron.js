import { getLoanApplicationStatus } from "./iute.js";
import { findOrderByNameOrTag, markOrderCancelled, markOrderInProgress, markOrderPaid, markOrderPending } from "./shopify.js";

// Map Iute statuses to Shopify actions (doc lists these statuses) :contentReference[oaicite:7]{index=7}
export async function syncOneOrder({ shop, accessToken, iuteDomain, adminKey, iuteOrderId }) {
  const status = await getLoanApplicationStatus({ iuteDomain, adminKey, orderId: iuteOrderId });

  // You must ensure your order is tagged: IUTE_ORDER_ID:<iuteOrderId>
  const order = await findOrderByNameOrTag({ shop, accessToken, orderNameOrId: iuteOrderId });
  if (!order) return { ok: false, reason: "Order not found in Shopify for iuteOrderId", iuteOrderId, status };

  // status could be object; normalize:
  const s = (status.status || status.applicationStatus || status.state || "").toUpperCase();

  if (s === "PENDING") await markOrderPending({ shop, accessToken, orderGid: order.id });
  else if (s === "IN PROGRESS" || s === "IN_PROGRESS") await markOrderInProgress({ shop, accessToken, orderGid: order.id });
  else if (s === "PAID" || s === "SIGNED" || s === "APPROVED") await markOrderPaid({ shop, accessToken, orderGid: order.id, note: `Iute status: ${s}` });
  else if (s === "CANCELLED" || s === "CANCELED") await markOrderCancelled({ shop, accessToken, orderGid: order.id, reason: `Iute status: ${s}` });

  return { ok: true, iuteOrderId, iuteStatus: s };
}
