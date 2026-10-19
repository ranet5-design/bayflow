import { api } from '../api.js';
import { busy, esc, fmtDateTime, formValues, money, openModal, toast } from '../ui.js';
import { poBadge } from './posBooking.js';

export async function renderInventory(box, shopId) {
  const [{ parts }, { purchaseOrders }] = await Promise.all([
    api(`/shops/${shopId}/parts`),
    api(`/shops/${shopId}/purchase-orders`),
  ]);
  const openPos = purchaseOrders.filter((po) => po.status !== 'RECEIVED');

  box.innerHTML = `
    <div class="card">
      <div class="row spread"><h3 style="margin:0">Purchase orders</h3>
        <button class="btn small secondary" id="newPo">New restock order</button></div>
      ${
        purchaseOrders.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>PO</th><th>Booking</th><th>Items (received / ordered)</th><th>Status</th><th></th></tr></thead>
              <tbody>${purchaseOrders
                .map(
                  (po) => `<tr>
                    <td>#${po.id}<div class="muted small">${fmtDateTime(po.createdAt)}${po.supplier ? ` &middot; ${esc(po.supplier)}` : ''}</div></td>
                    <td>${po.bookingId ? `#${po.bookingId}` : '<span class="muted">Restock</span>'}</td>
                    <td>${po.items.map((i) => `${esc(i.name)}: ${i.qtyReceived}/${i.qtyOrdered}`).join('<br>')}</td>
                    <td>${poBadge(po.status)}</td>
                    <td>${po.status !== 'RECEIVED' ? `<button class="btn small" data-receive="${po.id}">Receive</button>` : ''}</td>
                  </tr>`,
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted">No purchase orders yet.</p>'
      }
      ${openPos.length ? `<p class="muted small">${openPos.length} order(s) still waiting for delivery.</p>` : ''}
    </div>

    <div class="card">
      <div class="row spread"><h3 style="margin:0">Inventory</h3>
        <button class="btn small" id="addPart">Add part</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>SKU</th><th>Name</th><th class="num">On hand</th><th class="num">Reorder at</th><th class="num">Unit cost</th></tr></thead>
        <tbody>${parts
          .map(
            (p) => `<tr>
              <td>${esc(p.sku)}</td><td>${esc(p.name)} ${p.lowStock ? '<span class="badge red">low</span>' : ''}</td>
              <td class="num">${p.qtyOnHand}</td><td class="num">${p.reorderLevel}</td><td class="num">${money(p.unitCost)}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table></div>
    </div>`;

  const reload = () => renderInventory(box, shopId);

  box.querySelector('#addPart').onclick = () => {
    const { el, close } = openModal(`
      <h3>Add part</h3>
      <form class="form-grid">
        <div class="field"><label>SKU</label><input name="sku" required /></div>
        <div class="field"><label>Name</label><input name="name" required /></div>
        <div class="field"><label>Qty on hand</label><input name="qtyOnHand" type="number" min="0" value="0" required /></div>
        <div class="field"><label>Reorder level</label><input name="reorderLevel" type="number" min="0" value="2" required /></div>
        <div class="field"><label>Unit cost (PKR)</label><input name="unitCost" type="number" min="0" required /></div>
        <div class="row spread" style="grid-column:1/-1"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Add</button></div>
      </form>`);
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      busy(e.submitter, async () => {
        await api(`/shops/${shopId}/parts`, { method: 'POST', body: formValues(e.target) });
        toast('Part added');
        close();
        reload();
      });
    });
  };

  box.querySelector('#newPo').onclick = () => {
    const { el, close } = openModal(`
      <h3>New restock order</h3>
      <form>
        <div class="field"><label>Part</label><select name="partId" required>
          ${parts.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.qtyOnHand} on hand)</option>`).join('')}</select></div>
        <div class="field"><label>Quantity</label><input name="qty" type="number" min="1" value="5" required /></div>
        <div class="field"><label>Supplier (optional)</label><input name="supplier" /></div>
        <div class="row spread"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Create order</button></div>
      </form>`);
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      busy(e.submitter, async () => {
        await api(`/shops/${shopId}/purchase-orders`, {
          method: 'POST',
          body: {
            supplier: v.supplier || undefined,
            items: [{ partId: Number(v.partId), qty: Number(v.qty) }],
          },
        });
        toast('Purchase order created');
        close();
        reload();
      });
    });
  };

  box.querySelectorAll('[data-receive]').forEach((btn) => {
    btn.onclick = () => {
      const po = purchaseOrders.find((p) => p.id === Number(btn.dataset.receive));
      const { el, close } = openModal(`
        <h3>Receive PO #${po.id}</h3>
        <p class="muted small">Enter what actually arrived. Partial deliveries are fine, stock goes up by these amounts.</p>
        <form>
          ${po.items
            .map((i) => {
              const open = i.qtyOrdered - i.qtyReceived;
              return `<div class="field"><label>${esc(i.name)} (${open} still expected)</label>
                <input type="number" name="${i.id}" min="0" max="${open}" value="${open}" /></div>`;
            })
            .join('')}
          <div class="row spread"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Confirm receipt</button></div>
        </form>`);
      el.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const items = Object.entries(formValues(e.target)).map(([poItemId, qty]) => ({
          poItemId: Number(poItemId),
          qty: Number(qty || 0),
        }));
        busy(e.submitter, async () => {
          const res = await api(`/shops/${shopId}/purchase-orders/${po.id}/receive`, {
            method: 'POST',
            body: { items },
          });
          toast(res.status === 'RECEIVED' ? 'Order fully received' : 'Partial delivery recorded');
          close();
          window.dispatchEvent(new Event('data-changed'));
          reload();
        });
      });
    };
  });
}
