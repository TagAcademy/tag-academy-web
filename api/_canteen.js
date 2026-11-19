// The canteen's one rule for a purchase, shared by a student's own phone (api/student.js "buy")
// and the canteen tablet (api/canteen.js). Items live in state.canteen.items:
//   { id, name, emoji, price, cashPrice (dollars, or none = not sold for cash), stock (a number, or null = not counted), lowAt, barcode, active }
// A purchase is one ordinary "Spent/Redeemed" ledger entry (so balances, coin history and reports
// need nothing new) marked canteen: true, listing what was bought; stock goes down by what was sold.
// Paying in cash or with physical TAG coins is kept in state.canteen.sales instead (see sellOther).
const { withState } = require("../lib/appcode");

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const refuse = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };

function dayOf(d) {
  const utc = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))) return utc;
  return Math.abs(Date.parse(d) - Date.parse(utc)) <= 86400000 ? d : utc;
}

// The cart as [{ id, qty }] -> checked lines (stock checked). Throws (nothing is saved) if wrong.
function checkCart(st, cart) {
  const items = ((st.canteen || {}).items) || [];
  const want = new Map();
  (Array.isArray(cart) ? cart : []).forEach((c) => {
    const qty = Math.floor(Number(c && c.qty));
    if (c && typeof c.id === "string" && qty > 0) want.set(c.id, (want.get(c.id) || 0) + qty);
  });
  if (!want.size) refuse("Nothing in the cart.");
  const lines = [];
  want.forEach((qty, id) => {
    const it = items.find((x) => x.id === id);
    if (!it || it.active === false) refuse("Something in the cart isn’t sold anymore — take it out and try again.");
    if (qty > 50) refuse("That’s a lot of " + it.name + " — at most 50 at a time.");
    if (typeof it.stock === "number" && it.stock < qty) refuse(it.stock <= 0 ? it.name + " is sold out." : "There " + (it.stock === 1 ? "is" : "are") + " only " + it.stock + " " + it.name + " left.");
    lines.push({ id, name: it.name, qty, price: r2(it.price), cashPrice: typeof it.cashPrice === "number" ? r2(it.cashPrice) : null });
  });
  return lines;
}
function takeStock(st, lines) {
  const items = ((st.canteen || {}).items) || [];
  lines.forEach((l) => { const it = items.find((x) => x.id === l.id); if (it && typeof it.stock === "number") it.stock -= l.qty; });
}
const lineNote = (lines) => lines.map((l) => (l.qty > 1 ? l.qty + "× " : "") + l.name).join(", ");
const newId = () => "cn_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Paying from a student's TAG coin balance. `date` is the buyer's own calendar date (their
// device's), used if it's within a day of now.
function buy(st, studentId, cart, enteredBy, via, date) {
  const lines = checkCart(st, cart);
  const total = r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const bal = withState(st).computeStats(studentId, {}).balance;
  if (total > bal + 1e-9) refuse("That’s " + total + " TAG coins, and you have " + r2(bal) + ".");
  takeStock(st, lines);
  st.ledger = st.ledger || [];
  st.ledger.push({
    id: newId(), date: dayOf(date),
    studentId, type: "Spent/Redeemed", amount: total, canteen: true, items: lines.map(({ cashPrice, ...l }) => l), via: via || "phone",
    note: "Canteen: " + lineNote(lines), enteredBy, enteredAt: Date.now(),
  });
  return { total, lines, balance: r2(bal - total) };
}

// Paying in cash ("cash", at each item's cash price) or with physical TAG coins ("coins", at the
// TAG coin price): no balance changes -- the money goes in the canteen box -- but the stock goes
// down and the sale is kept in state.canteen.sales so an admin can count the box against it.
function sellOther(st, cart, method, who, via, date) {
  if (method !== "cash" && method !== "coins") refuse("Choose how you’re paying.");
  const lines = checkCart(st, cart);
  if (method === "cash") { const no = lines.find((l) => l.cashPrice === null); if (no) refuse(no.name + " doesn’t have a cash price — pay with TAG coins instead."); }
  const total = r2(lines.reduce((s, l) => s + (method === "cash" ? l.cashPrice : l.price) * l.qty, 0));
  takeStock(st, lines);
  st.canteen.sales = st.canteen.sales || [];
  st.canteen.sales.push(Object.assign({ id: newId(), date: dayOf(date), at: Date.now(), method, total, via: via || "phone", items: lines, note: lineNote(lines) }, who || {}));
  // Keep the list from growing forever: the last 2000 sales.
  if (st.canteen.sales.length > 2000) st.canteen.sales = st.canteen.sales.slice(-2000);
  return { total, lines };
}

// What a shop screen needs to show (no barcodes are secret, but nothing else is sent).
function itemsForShop(st) {
  return (((st.canteen || {}).items) || []).filter((x) => x.active !== false)
    .map((x) => ({ id: x.id, name: x.name, emoji: x.emoji || "", price: r2(x.price), cashPrice: typeof x.cashPrice === "number" ? r2(x.cashPrice) : null, stock: typeof x.stock === "number" ? x.stock : null, barcode: x.barcode || "" }));
}

module.exports = { buy, sellOther, itemsForShop };
