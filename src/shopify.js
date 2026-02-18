export async function shopifyGraphQL({ shop, accessToken, query, variables }) {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": accessToken
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

export async function findOrderByNameOrTag({ shop, accessToken, orderNameOrId }) {
  // You need a reliable link between iute orderId and shopify order.
  // Easiest: store iute orderId in Shopify order tags: "IUTE_ORDER_ID:<id>"
  const q = `tag:IUTE_ORDER_ID:${orderNameOrId}`;
  const data = await shopifyGraphQL({
    shop,
    accessToken,
    query: `
      query($q: String!) {
        orders(first: 1, query: $q) {
          edges { node { id name displayFinancialStatus displayFulfillmentStatus tags } }
        }
      }
    `,
    variables: { q }
  });

  const edge = data.orders.edges[0];
  return edge ? edge.node : null;
}

export async function addOrderTag({ shop, accessToken, orderGid, tag }) {
  await shopifyGraphQL({
    shop,
    accessToken,
    query: `
      mutation($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
      }
    `,
    variables: { id: orderGid, tags: [tag] }
  });
}

export async function markOrderPaid({ shop, accessToken, orderGid, note }) {
  // This is a lightweight approach: add tags/notes and optionally mark as paid via transactions if your setup supports it.
  // Many stores prefer: keep financial status as pending and let staff capture/fulfill after verification.
  await shopifyGraphQL({
    shop,
    accessToken,
    query: `
      mutation($id: ID!, $note: String!) {
        orderUpdate(input: {id: $id, note: $note}) {
          order { id }
          userErrors { field message }
        }
      }
    `,
    variables: { id: orderGid, note }
  });

  await addOrderTag({ shop, accessToken, orderGid, tag: "IUTE_STATUS:PAID" });
}

export async function markOrderCancelled({ shop, accessToken, orderGid, reason }) {
  await shopifyGraphQL({
    shop,
    accessToken,
    query: `
      mutation($id: ID!, $reason: OrderCancelReason, $staffNote: String) {
        orderCancel(orderId: $id, reason: $reason, staffNote: $staffNote) {
          job { id }
          userErrors { field message }
        }
      }
    `,
    variables: { id: orderGid, reason: "CUSTOMER", staffNote: reason }
  });

  await addOrderTag({ shop, accessToken, orderGid, tag: "IUTE_STATUS:CANCELLED" });
}

export async function markOrderInProgress({ shop, accessToken, orderGid }) {
  await addOrderTag({ shop, accessToken, orderGid, tag: "IUTE_STATUS:IN_PROGRESS" });
}

export async function markOrderPending({ shop, accessToken, orderGid }) {
  await addOrderTag({ shop, accessToken, orderGid, tag: "IUTE_STATUS:PENDING" });
}
