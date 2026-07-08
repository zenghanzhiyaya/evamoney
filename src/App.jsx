import { useState, useEffect, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Plus, Trash2, Wallet, TrendingUp, TrendingDown, Download, Pencil } from "lucide-react";
import * as XLSX from "xlsx";

const BASE_CATEGORIES = [
  { key: "food", label: "餐饮", color: "#C85647" },
  { key: "transport", label: "交通", color: "#52443C" },
  { key: "entertainment", label: "娱乐", color: "#2E4356" },
  { key: "rent", label: "水电", color: "#4A7690" },
  { key: "shopping", label: "购物", color: "#E89494" },
  { key: "subscription", label: "订阅", color: "#7FA3B8" },
  { key: "misc", label: "杂项", color: "#B37F6C" },
  { key: "fund", label: "基金", color: "#745E92" },
];

// colors auto-assigned to custom categories as they're added, cycling through the palette
const CUSTOM_CATEGORY_PALETTE = [
  "#4A8FA8", "#C4783A", "#7A9E5C", "#B85C7A", "#8A6FB0", "#C9A227", "#5C7A8A", "#A85C4A",
];

const ASSET_CATEGORIES = [
  { key: "cash", label: "现金", color: "#5C8F5C" },
  { key: "deposit", label: "存款", color: "#7FA3B8" },
  { key: "investment", label: "投资", color: "#E89494" },
  { key: "property", label: "房产", color: "#4A7690" },
  { key: "other", label: "其他", color: "#B37F6C" },
];
const ASSET_CAT_MAP = Object.fromEntries(ASSET_CATEGORIES.map(c => [c.key, c]));

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}

function formatMoney(n) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MonthlyLedger() {
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ category: "food", amount: "", excludedAmount: "", note: "", date: todayISO(), cardId: "", fundId: "", isRefund: false });
  const [selectedMonth, setSelectedMonth] = useState(todayISO().slice(0, 7));
  const [activeTab, setActiveTab] = useState("quickadd"); // default landing tab
  const [stampFlash, setStampFlash] = useState(false);
  const [error, setError] = useState("");

  // custom categories — user-added, layered on top of the built-in ones
  const [customCategories, setCustomCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:customCategories", false);
        if (res && res.value) setCustomCategories(JSON.parse(res.value));
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { await window.storage.set("ledger:customCategories", JSON.stringify(customCategories), false); } catch (e) {}
    })();
  }, [customCategories]);

  const CATEGORIES = useMemo(() => [...BASE_CATEGORIES, ...customCategories], [customCategories]);
  const CAT_MAP = useMemo(() => Object.fromEntries(CATEGORIES.map(c => [c.key, c])), [CATEGORIES]);
  // budget page only tracks discretionary categories — subscriptions, funds, and utilities
  // have their own dedicated tracking elsewhere and don't need a manual monthly budget
  const BUDGET_CATEGORIES = useMemo(
    () => CATEGORIES.filter(c => !["subscription", "fund", "rent"].includes(c.key)),
    [CATEGORIES]
  );

  const [showAddCategory, setShowAddCategory] = useState(false);

  function addCategory(onCreated) {
    const name = newCategoryName.trim();
    if (!name) { setCategoryError("请输入分类名称"); return; }
    if (CATEGORIES.some(c => c.label === name)) { setCategoryError("已经有同名分类了"); return; }
    setCategoryError("");
    const key = "custom_" + name.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now().toString(36);
    const color = CUSTOM_CATEGORY_PALETTE[customCategories.length % CUSTOM_CATEGORY_PALETTE.length];
    setCustomCategories(prev => [...prev, { key, label: name, color }]);
    setNewCategoryName("");
    setShowAddCategory(false);
    if (onCreated) onCreated(key);
  }

  function removeCategory(key) {
    setCustomCategories(prev => prev.filter(c => c.key !== key));
  }


  // load
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:entries", false);
        if (res && res.value) setEntries(JSON.parse(res.value));
      } catch (e) {
        // no existing data yet
      }
      setLoaded(true);
    })();
  }, []);

  // persist
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await window.storage.set("ledger:entries", JSON.stringify(entries), false);
      } catch (e) {
        console.error("save failed", e);
      }
    })();
  }, [entries, loaded]);

  // recurring expenses — auto-deducted subscriptions etc, generated as virtual entries every month
  const [recurringExpenses, setRecurringExpenses] = useState([]);
  const [recurringForm, setRecurringForm] = useState({ name: "", amount: "", day: "", cardId: "", startMonth: todayISO().slice(0, 7), frequency: "monthly" });
  const [recurringError, setRecurringError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:recurring", false);
        if (res && res.value) setRecurringExpenses(JSON.parse(res.value));
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { await window.storage.set("ledger:recurring", JSON.stringify(recurringExpenses), false); } catch (e) {}
    })();
  }, [recurringExpenses]);

  function addRecurring() {
    const amt = parseFloat(recurringForm.amount);
    const day = parseInt(recurringForm.day, 10);
    if (!recurringForm.name.trim()) { setRecurringError("请输入订阅/扣款名称"); return; }
    if (!amt || amt <= 0) { setRecurringError("请输入有效金额"); return; }
    if (!day || day < 1 || day > 31) { setRecurringError("请输入有效的扣款日（1-31）"); return; }
    if (!recurringForm.startMonth) { setRecurringError("请选择开始时间"); return; }
    setRecurringError("");
    setRecurringExpenses(prev => [...prev, {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: recurringForm.name.trim(),
      amount: amt,
      day,
      cardId: recurringForm.cardId || "",
      startMonth: recurringForm.startMonth,
      frequency: recurringForm.frequency || "monthly",
    }]);
    setRecurringForm({ ...recurringForm, name: "", amount: "", day: "" });
  }

  function removeRecurring(id) {
    setRecurringExpenses(prev => prev.filter(r => r.id !== id));
  }

  // "结束订阅" only stops future months from being generated — past and the current month stay untouched
  function endRecurring(id, month) {
    setRecurringExpenses(prev => prev.map(r => r.id === id ? { ...r, endMonth: month } : r));
  }

  function reactivateRecurring(id) {
    setRecurringExpenses(prev => prev.map(r => r.id === id ? { ...r, endMonth: null } : r));
  }

  // a subscription's price can change over time; editing one month's amount never touches another month
  function getRecurringAmount(r, month) {
    if (r.amountByMonth && r.amountByMonth[month] !== undefined && r.amountByMonth[month] !== null) {
      return r.amountByMonth[month];
    }
    return r.amount ?? 0; // fall back to the original amount as a baseline
  }

  function updateRecurringAmount(id, month, value) {
    setRecurringExpenses(prev => prev.map(r => r.id === id
      ? { ...r, amountByMonth: { ...(r.amountByMonth || {}), [month]: value } }
      : r
    ));
  }

  const [editingRecurringId, setEditingRecurringId] = useState(null);
  const [editRecurringAmountInput, setEditRecurringAmountInput] = useState("");

  const monthsAvailable = useMemo(() => {
    const set = new Set(entries.map(e => monthKey(e.date)));
    set.add(selectedMonth);
    return Array.from(set).sort().reverse();
  }, [entries, selectedMonth]);

  const recurringVirtualEntries = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return recurringExpenses
      .filter(r => {
        const start = r.startMonth || "0000-00"; // legacy entries with no startMonth: always apply
        if (selectedMonth < start) return false; // hasn't started yet — never touches earlier months
        if (r.endMonth && selectedMonth > r.endMonth) return false; // ended — never touches months after it stopped
        if (r.frequency === "yearly") {
          const startMonthNum = start.split("-")[1];
          const curMonthNum = selectedMonth.split("-")[1];
          return curMonthNum === startMonthNum;
        }
        return true; // monthly
      })
      .map(r => ({
        id: `recurring-${r.id}-${selectedMonth}`,
        category: "",
        amount: getRecurringAmount(r, selectedMonth),
        note: `${r.name}（自动扣款）`,
        date: `${selectedMonth}-${String(Math.min(r.day, lastDay)).padStart(2, "0")}`,
        cardId: r.cardId || "",
        fundId: "",
        recurring: true,
        recurringId: r.id,
      }));
  }, [recurringExpenses, selectedMonth]);

  const monthEntries = useMemo(
    () => [...entries.filter(e => monthKey(e.date) === selectedMonth), ...recurringVirtualEntries].sort((a, b) => b.date.localeCompare(a.date)),
    [entries, selectedMonth, recurringVirtualEntries]
  );

  // transfers — money in/out between the user and other people, flows through cash flow.
  // moved above totalsByCategory because an outgoing transfer can optionally count as a category expense
  // (e.g. reimbursing a friend who fronted a shared bill)
  const [transfers, setTransfers] = useState([]);
  const [transferForm, setTransferForm] = useState({ direction: "in", person: "", amount: "", note: "", date: todayISO(), countAsExpense: false, category: "food" });
  const [transferError, setTransferError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:transfers", false);
        if (res && res.value) setTransfers(JSON.parse(res.value));
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { await window.storage.set("ledger:transfers", JSON.stringify(transfers), false); } catch (e) {}
    })();
  }, [transfers]);

  const monthTransfers = useMemo(
    () => transfers.filter(t => monthKey(t.date) === selectedMonth).sort((a, b) => b.date.localeCompare(a.date)),
    [transfers, selectedMonth]
  );

  const netTransfers = useMemo(
    // transfers already counted as a category expense are excluded here to avoid double-subtracting
    // them from the top-level balance (once via totalsByCategory, once via netTransfers)
    () => monthTransfers
      .filter(t => !t.countAsExpense)
      .reduce((a, t) => a + (t.direction === "in" ? t.amount : -t.amount), 0),
    [monthTransfers]
  );

  function addTransfer() {
    const amt = parseFloat(transferForm.amount);
    if (!transferForm.person.trim()) { setTransferError("请输入对方姓名/备注"); return; }
    if (!amt || amt <= 0) { setTransferError("请输入有效金额"); return; }
    if (transferForm.direction === "out" && transferForm.countAsExpense && !transferForm.category) {
      setTransferError("请选择这笔支出属于哪个分类");
      return;
    }
    setTransferError("");
    setTransfers(prev => [...prev, {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      direction: transferForm.direction,
      person: transferForm.person.trim(),
      amount: amt,
      note: transferForm.note.trim(),
      date: transferForm.date,
      countAsExpense: transferForm.direction === "out" ? transferForm.countAsExpense : false,
      category: transferForm.direction === "out" && transferForm.countAsExpense ? transferForm.category : "",
    }]);
    setTransferForm({ ...transferForm, amount: "", note: "" });
  }

  function removeTransfer(id) {
    setTransfers(prev => prev.filter(t => t.id !== id));
  }

  // total spending for an arbitrary month (used by the trend tab) — mirrors the logic used for
  // the selected month's totalsByCategory/recurringTotal, but generalized to any month
  function computeTotalSpentForMonth(month) {
    let total = 0;
    entries.filter(e => monthKey(e.date) === month).forEach(e => {
      const net = e.amount - (e.excludedAmount || 0);
      total += e.isRefund ? -net : net;
    });
    recurringExpenses.forEach(r => {
      const start = r.startMonth || "0000-00";
      if (month < start) return;
      if (r.endMonth && month > r.endMonth) return;
      if (r.frequency === "yearly" && month.split("-")[1] !== start.split("-")[1]) return;
      total += getRecurringAmount(r, month);
    });
    transfers.filter(t => monthKey(t.date) === month).forEach(t => {
      if (t.direction === "out" && t.countAsExpense && t.category) total += t.amount;
    });
    return total;
  }

  const trendMonths = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(adjacentMonthKey(selectedMonth, -i));
    return months;
  }, [selectedMonth]);

  const monthlyTrend = useMemo(
    () => trendMonths.map(m => ({ month: m, total: computeTotalSpentForMonth(m) })),
    [trendMonths, entries, recurringExpenses, transfers]
  );

  const totalsByCategory = useMemo(() => {
    const t = Object.fromEntries(CATEGORIES.map(c => [c.key, 0]));
    monthEntries.forEach(e => {
      if (!e.recurring) {
        const net = e.amount - (e.excludedAmount || 0);
        t[e.category] = (t[e.category] || 0) + (e.isRefund ? -net : net);
      }
    });
    monthTransfers.forEach(tr => {
      if (tr.direction === "out" && tr.countAsExpense && tr.category) {
        t[tr.category] = (t[tr.category] || 0) + tr.amount;
      }
    });
    return t;
  }, [monthEntries, monthTransfers]);

  const recurringTotal = useMemo(
    () => recurringVirtualEntries.reduce((a, e) => a + e.amount, 0),
    [recurringVirtualEntries]
  );

  const totalSpent = useMemo(
    () => Object.values(totalsByCategory).reduce((a, b) => a + b, 0) + recurringTotal,
    [totalsByCategory, recurringTotal]
  );

  const totalsByCard = useMemo(() => {
    const t = {};
    monthEntries.forEach(e => {
      // credit card totals reflect what was actually charged, not the excluded/shared portion
      if (e.cardId) t[e.cardId] = (t[e.cardId] || 0) + (e.isRefund ? -e.amount : e.amount);
    });
    return t;
  }, [monthEntries]);

  // income assumption: paid on 15th and 30th of each month, varies month to month
  const [payAmountByMonth, setPayAmountByMonth] = useState({});
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:payAmount", false);
        if (res && res.value) {
          const v = JSON.parse(res.value);
          if (v && typeof v === "object" && !Array.isArray(v)) {
            setPayAmountByMonth(v);
          } else if (typeof v === "number") {
            // migrate legacy single-value shape: apply it to the current real-world month only
            setPayAmountByMonth({ [todayISO().slice(0, 7)]: v });
          }
        }
      } catch (e) {}
    })();
  }, []);
  useEffect(() => {
    (async () => {
      try { await window.storage.set("ledger:payAmount", JSON.stringify(payAmountByMonth), false); } catch (e) {}
    })();
  }, [payAmountByMonth]);

  const payAmount = payAmountByMonth[selectedMonth] ?? null;
  function updatePayAmount(value) {
    setPayAmountByMonth(prev => ({ ...prev, [selectedMonth]: value }));
  }

  const monthlyIncome = payAmount ? payAmount * 2 : 0;

  // rent — varies month to month, so it's stored per-month; editing one month never touches another
  const [rentByMonth, setRentByMonth] = useState({});
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:rent", false);
        if (res && res.value) {
          const v = JSON.parse(res.value);
          if (v && (("amount" in v) || ("day" in v))) {
            // migrate legacy single-value shape: apply it to the current real-world month only
            setRentByMonth({ [todayISO().slice(0, 7)]: { amount: v.amount ?? null, day: v.day ?? null } });
          } else if (v) {
            setRentByMonth(v);
          }
        }
      } catch (e) {}
    })();
  }, []);
  useEffect(() => {
    (async () => {
      try { await window.storage.set("ledger:rent", JSON.stringify(rentByMonth), false); } catch (e) {}
    })();
  }, [rentByMonth]);

  const rent = rentByMonth[selectedMonth] || { amount: null, day: null };
  function updateRent(field, value) {
    setRentByMonth(prev => ({
      ...prev,
      [selectedMonth]: { ...(prev[selectedMonth] || { amount: null, day: null }), [field]: value },
    }));
  }

  // credit card repayment planning — supports multiple cards
  const [cards, setCards] = useState([]);
  const [startBalanceByMonth, setStartBalanceByMonth] = useState({});
  const [cardForm, setCardForm] = useState({ name: "", dueDay: "", amount: "" });
  const [cardError, setCardError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:ccPlan", false);
        if (res && res.value) {
          const v = JSON.parse(res.value);
          if (Array.isArray(v.cards)) setCards(v.cards);
          else if (v.ccDueDay && v.ccAmount) {
            // migrate legacy single-card shape
            setCards([{ id: "legacy", name: "信用卡", dueDay: v.ccDueDay, amount: v.ccAmount }]);
          }
          if (v.startBalanceByMonth && typeof v.startBalanceByMonth === "object") {
            setStartBalanceByMonth(v.startBalanceByMonth);
          } else if (v.startBalance !== undefined && v.startBalance !== null) {
            // migrate legacy single-value shape: apply it to the current real-world month only
            setStartBalanceByMonth({ [todayISO().slice(0, 7)]: v.startBalance });
          }
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await window.storage.set("ledger:ccPlan", JSON.stringify({ cards, startBalanceByMonth }), false);
      } catch (e) {}
    })();
  }, [cards, startBalanceByMonth]);

  const startBalance = startBalanceByMonth[selectedMonth] ?? null;
  function updateStartBalance(value) {
    setStartBalanceByMonth(prev => ({ ...prev, [selectedMonth]: value }));
  }

  function addCard() {
    const day = parseInt(cardForm.dueDay, 10);
    const amt = parseFloat(cardForm.amount);
    if (!cardForm.name.trim()) { setCardError("请输入卡片名称"); return; }
    if (!day || day < 1 || day > 31) { setCardError("请输入有效的还款日（1-31）"); return; }
    if (!amt || amt <= 0) { setCardError("请输入有效的还款金额"); return; }
    setCardError("");
    setCards(prev => [...prev, { id: Date.now().toString(36), name: cardForm.name.trim(), dueDay: day, amount: amt }]);
    setCardForm({ name: "", dueDay: "", amount: "" });
  }

  function removeCard(id) {
    setCards(prev => prev.filter(c => c.id !== id));
  }

  // a card's repayment amount (statement balance) varies month to month;
  // editing one month's amount never touches another month's stored value
  function getCardAmount(card, month) {
    if (card.amountByMonth && card.amountByMonth[month] !== undefined && card.amountByMonth[month] !== null) {
      return card.amountByMonth[month];
    }
    return card.amount ?? 0; // fall back to the original amount as a baseline
  }

  function updateCardAmount(cardId, month, value) {
    setCards(prev => prev.map(c => c.id === cardId
      ? { ...c, amountByMonth: { ...(c.amountByMonth || {}), [month]: value } }
      : c
    ));
  }

  const [editingCardId, setEditingCardId] = useState(null);
  const [editAmountInput, setEditAmountInput] = useState("");

  // savings goals (a.k.a. funds, managed jointly with the "基金管理" tab)
  const [savingsGoals, setSavingsGoals] = useState([]);
  const [goalForm, setGoalForm] = useState({ name: "", target: "" });
  const [goalError, setGoalError] = useState("");
  const [contribInput, setContribInput] = useState({}); // { [goalId]: amountString }

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:savings", false);
        if (res && res.value) {
          const v = JSON.parse(res.value);
          setSavingsGoals(Array.isArray(v.goals) ? v.goals : []);
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await window.storage.set("ledger:savings", JSON.stringify({ goals: savingsGoals }), false);
      } catch (e) {}
    })();
  }, [savingsGoals]);

  function addGoal() {
    const target = parseFloat(goalForm.target);
    if (!goalForm.name.trim()) { setGoalError("请输入储蓄目标名称"); return; }
    if (!target || target <= 0) { setGoalError("请输入有效的目标金额"); return; }
    setGoalError("");
    setSavingsGoals(prev => [...prev, { id: Date.now().toString(36), name: goalForm.name.trim(), target, saved: 0, usageLog: [] }]);
    setGoalForm({ name: "", target: "" });
  }

  function removeGoal(id) {
    setSavingsGoals(prev => prev.filter(g => g.id !== id));
  }

  function addContribution(id) {
    const amt = parseFloat(contribInput[id]);
    if (!amt || amt <= 0) return;
    setSavingsGoals(prev => prev.map(g => g.id === id ? { ...g, saved: g.saved + amt } : g));
    setContribInput(prev => ({ ...prev, [id]: "" }));
  }

  // fund usage — "使用" a savings goal withdraws from it and syncs into the ledger as a transfer-in
  const [usageInput, setUsageInput] = useState({}); // { [goalId]: amountString }
  const [usageError, setUsageError] = useState({}); // { [goalId]: errorString }

  function useFund(id) {
    const goal = savingsGoals.find(g => g.id === id);
    const amt = parseFloat(usageInput[id]);
    if (!goal) return;
    if (!amt || amt <= 0) {
      setUsageError(prev => ({ ...prev, [id]: "请输入有效金额" }));
      return;
    }
    if (amt > goal.saved) {
      setUsageError(prev => ({ ...prev, [id]: "超过基金余额" }));
      return;
    }
    setUsageError(prev => ({ ...prev, [id]: "" }));

    const today = todayISO();
    setSavingsGoals(prev => prev.map(g => g.id === id
      ? {
          ...g,
          saved: g.saved - amt,
          usageLog: [...(g.usageLog || []), { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), amount: amt, date: today }],
        }
      : g
    ));

    // sync into the ledger: money leaving the fund becomes an inflow to cash, on the current date
    setTransfers(prev => [...prev, {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      direction: "in",
      person: `基金 · ${goal.name}`,
      amount: amt,
      note: "基金支取",
      date: today,
    }]);

    setUsageInput(prev => ({ ...prev, [id]: "" }));
  }

  function daysInMonth(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  const cashflowTimeline = useMemo(() => {
    const lastDay = daysInMonth(selectedMonth);
    const events = [];

    // paydays
    [15, 30].forEach(d => {
      const day = Math.min(d, lastDay);
      if (payAmount) {
        events.push({ date: `${selectedMonth}-${String(day).padStart(2, "0")}`, label: "发薪", amount: payAmount, type: "income" });
      }
    });

    // note: individual expenses are not added here since they're paid by credit card;
    // their cash-flow impact happens on the card's repayment date instead.

    // rent (fixed recurring, not per-transaction)
    if (rent.amount && rent.day) {
      const day = Math.min(rent.day, lastDay);
      events.push({ date: `${selectedMonth}-${String(day).padStart(2, "0")}`, label: "房租", amount: -rent.amount, type: "rent" });
    }

    // credit card dues
    cards.forEach(c => {
      const day = Math.min(c.dueDay, lastDay);
      events.push({ date: `${selectedMonth}-${String(day).padStart(2, "0")}`, label: `${c.name} 还款`, amount: -getCardAmount(c, selectedMonth), type: "cc", cardId: c.id });
    });

    // person-to-person transfers
    monthTransfers.forEach(t => {
      const sign = t.direction === "in" ? 1 : -1;
      const verb = t.direction === "in" ? "转入" : "转出";
      events.push({
        date: t.date,
        label: `${t.person} ${verb}${t.note ? " · " + t.note : ""}`,
        amount: sign * t.amount,
        type: "transfer",
      });
    });

    events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "cc" ? 1 : -1));

    let running = startBalance || 0;
    const rows = events.map(ev => {
      running += ev.amount;
      return { ...ev, running };
    });
    return rows;
  }, [selectedMonth, payAmountByMonth, cards, startBalanceByMonth, rentByMonth, monthTransfers]);

  const ccWarnings = useMemo(() => {
    return cashflowTimeline.filter(r => (r.type === "cc" || r.type === "saving" || r.type === "rent") && r.running < 0);
  }, [cashflowTimeline]);

  const totalSaved = useMemo(() => savingsGoals.reduce((a, g) => a + g.saved, 0), [savingsGoals]);


  const pieData = CATEGORIES
    .filter(c => c.key !== "fund")
    .map(c => ({
      name: c.label,
      value: c.key === "subscription" ? (totalsByCategory[c.key] || 0) + recurringTotal : totalsByCategory[c.key],
      color: c.color,
    }))
    .filter(d => d.value > 0);

  function addEntry() {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) {
      setError("请输入有效金额");
      return;
    }
    if (form.isRefund && !form.cardId) {
      setError("退款请选择退到哪张信用卡");
      return;
    }
    if (!form.isRefund && form.category === "fund" && !form.fundId) {
      setError("请选择这笔支出来自哪个基金");
      return;
    }
    if (!form.isRefund && form.category === "fund" && form.fundId) {
      const g = savingsGoals.find(x => x.id === form.fundId);
      if (g && amt > g.saved) {
        setError(`超过该基金余额（剩余 $${formatMoney(g.saved)}）`);
        return;
      }
    }
    const excluded = parseFloat(form.excludedAmount) || 0;
    if (excluded < 0) {
      setError("分摊金额不能是负数");
      return;
    }
    if (excluded >= amt) {
      setError("分摊金额不能大于或等于总金额");
      return;
    }
    setError("");
    const newEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      category: form.category,
      amount: amt,
      excludedAmount: excluded,
      note: form.note.trim(),
      date: form.date,
      cardId: form.cardId || "",
      fundId: !form.isRefund && form.category === "fund" ? form.fundId : "",
      isRefund: form.isRefund,
    };
    setEntries(prev => [...prev, newEntry]);

    // this is spending FROM the fund (not a contribution) — sync it as a deduction/usage on that savings goal
    if (!form.isRefund && form.category === "fund" && form.fundId) {
      setSavingsGoals(prev => prev.map(g => g.id === form.fundId
        ? {
            ...g,
            saved: Math.max(0, g.saved - amt),
            usageLog: [...(g.usageLog || []), { id: newEntry.id, amount: amt, date: form.date }],
          }
        : g
      ));
    }

    setForm({ ...form, amount: "", excludedAmount: "", note: "" });
    setStampFlash(true);
    setTimeout(() => setStampFlash(false), 650);
  }

  // custom numeric keypad for quick-add
  function pressKeypad(key) {
    setForm(prev => {
      let cur = prev.amount || "";
      if (key === "back") {
        cur = cur.slice(0, -1);
      } else if (key === "clear") {
        cur = "";
      } else if (key === ".") {
        if (!cur.includes(".")) cur = cur === "" ? "0." : cur + ".";
      } else {
        // digit 0-9
        if (cur === "0") cur = key;
        else cur = cur + key;
      }
      return { ...prev, amount: cur };
    });
  }

  function removeEntry(id) {
    const target = entries.find(e => e.id === id);
    if (target && !target.isRefund && target.category === "fund" && target.fundId) {
      setSavingsGoals(prev => prev.map(g => g.id === target.fundId
        ? { ...g, saved: g.saved + target.amount, usageLog: (g.usageLog || []).filter(u => u.id !== target.id) }
        : g
      ));
    }
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  function shiftMonth(dir) {
    const [y, m] = selectedMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  function adjacentMonthKey(ym, dir) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // budget planning — a per-category monthly budget, suggested from a prior month's actual spend.
  // stored per-month so editing this month's budget never rewrites another month's plan
  const [budgetsByMonth, setBudgetsByMonth] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:budgets", false);
        if (res && res.value) {
          const v = JSON.parse(res.value);
          if (v && Object.values(v).some(x => x && typeof x === "object")) {
            setBudgetsByMonth(v);
          } else if (v && Object.keys(v).length > 0) {
            // migrate legacy flat shape: apply it to the current real-world month only
            setBudgetsByMonth({ [todayISO().slice(0, 7)]: v });
          }
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { await window.storage.set("ledger:budgets", JSON.stringify(budgetsByMonth), false); } catch (e) {}
    })();
  }, [budgetsByMonth]);

  const budgets = budgetsByMonth[selectedMonth] || {};

  const prevMonthKey = useMemo(() => adjacentMonthKey(selectedMonth, -1), [selectedMonth]);

  const prevMonthTotalsByCategory = useMemo(() => {
    const t = Object.fromEntries(CATEGORIES.map(c => [c.key, 0]));
    entries.filter(e => monthKey(e.date) === prevMonthKey).forEach(e => {
      const net = e.amount - (e.excludedAmount || 0);
      t[e.category] = (t[e.category] || 0) + (e.isRefund ? -net : net);
    });
    transfers.filter(tr => monthKey(tr.date) === prevMonthKey).forEach(tr => {
      if (tr.direction === "out" && tr.countAsExpense && tr.category) {
        t[tr.category] = (t[tr.category] || 0) + tr.amount;
      }
    });
    return t;
  }, [entries, transfers, prevMonthKey]);

  const hasPrevMonthData = useMemo(
    () => BUDGET_CATEGORIES.some(c => (prevMonthTotalsByCategory[c.key] || 0) > 0),
    [prevMonthTotalsByCategory]
  );

  function generateBudgetFromPrevMonth() {
    const rounded = Object.fromEntries(
      BUDGET_CATEGORIES.map(c => [c.key, Math.round((prevMonthTotalsByCategory[c.key] || 0) * 100) / 100])
    );
    setBudgetsByMonth(prev => ({
      ...prev,
      [selectedMonth]: { ...(prev[selectedMonth] || {}), ...rounded },
    }));
  }

  function updateBudget(key, value) {
    setBudgetsByMonth(prev => ({
      ...prev,
      [selectedMonth]: { ...(prev[selectedMonth] || {}), [key]: value === "" ? 0 : parseFloat(value) },
    }));
  }

  const totalBudget = useMemo(
    () => BUDGET_CATEGORIES.reduce((a, c) => a + (budgets[c.key] || 0), 0),
    [budgets]
  );

  const budgetableSpent = useMemo(
    () => BUDGET_CATEGORIES.reduce((a, c) => a + (totalsByCategory[c.key] || 0), 0),
    [totalsByCategory]
  );

  const balance = monthlyIncome - totalSpent - (rent.amount || 0) + netTransfers;

  // asset management — separate from monthly ledger, tracks net worth over time
  const [assets, setAssets] = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [assetForm, setAssetForm] = useState({ name: "", category: "cash", value: "" });
  const [assetError, setAssetError] = useState("");
  const [liabilityForm, setLiabilityForm] = useState({ name: "", value: "" });
  const [liabilityError, setLiabilityError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("ledger:assets", false);
        if (res && res.value) {
          const v = JSON.parse(res.value);
          setAssets(Array.isArray(v.assets) ? v.assets : []);
          setLiabilities(Array.isArray(v.liabilities) ? v.liabilities : []);
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { await window.storage.set("ledger:assets", JSON.stringify({ assets, liabilities }), false); } catch (e) {}
    })();
  }, [assets, liabilities]);

  function addAsset() {
    const val = parseFloat(assetForm.value);
    if (!assetForm.name.trim()) { setAssetError("请输入资产名称"); return; }
    if (!val || val <= 0) { setAssetError("请输入有效金额"); return; }
    setAssetError("");
    setAssets(prev => [...prev, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: assetForm.name.trim(), category: assetForm.category, value: val }]);
    setAssetForm({ ...assetForm, name: "", value: "" });
  }

  function removeAsset(id) {
    setAssets(prev => prev.filter(a => a.id !== id));
  }

  function addLiability() {
    const val = parseFloat(liabilityForm.value);
    if (!liabilityForm.name.trim()) { setLiabilityError("请输入负债名称"); return; }
    if (!val || val <= 0) { setLiabilityError("请输入有效金额"); return; }
    setLiabilityError("");
    setLiabilities(prev => [...prev, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: liabilityForm.name.trim(), value: val }]);
    setLiabilityForm({ name: "", value: "" });
  }

  function removeLiability(id) {
    setLiabilities(prev => prev.filter(l => l.id !== id));
  }

  const totalAssets = useMemo(() => assets.reduce((a, x) => a + x.value, 0), [assets]);
  const totalLiabilities = useMemo(() => liabilities.reduce((a, x) => a + x.value, 0), [liabilities]);
  const netWorth = totalAssets - totalLiabilities;

  const assetPieData = useMemo(() => {
    const totals = {};
    assets.forEach(a => { totals[a.category] = (totals[a.category] || 0) + a.value; });
    return ASSET_CATEGORIES
      .map(c => ({ name: c.label, value: totals[c.key] || 0, color: c.color }))
      .filter(d => d.value > 0);
  }, [assets]);

  function sheetOrPlaceholder(data, placeholderMsg) {
    return XLSX.utils.json_to_sheet(data.length ? data : [{ 提示: placeholderMsg }]);
  }

  function exportMonthlyExcel() {
    const wb = XLSX.utils.book_new();

    // 1. expense details for the selected month
    const expenseRows = monthEntries.map(e => ({
      日期: e.date,
      分类: e.recurring ? "订阅/自动扣款" : (CAT_MAP[e.category]?.label || e.category),
      金额: e.isRefund ? -e.amount : e.amount,
      他人分摊: e.excludedAmount || 0,
      计入支出: e.isRefund ? -e.amount : (e.amount - (e.excludedAmount || 0)),
      类型: e.isRefund ? "退款" : (e.recurring ? "订阅" : "支出"),
      信用卡: (e.cardId && cards.find(c => c.id === e.cardId)?.name) || "",
      基金: (e.fundId && savingsGoals.find(g => g.id === e.fundId)?.name) || "",
      备注: e.note || "",
    }));
    XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(expenseRows, "本月暂无支出记录"), "支出明细");

    // 2. budget vs actual (discretionary categories only)
    const budgetRows = BUDGET_CATEGORIES.map(c => ({
      分类: c.label,
      预算: budgets[c.key] || 0,
      实际支出: totalsByCategory[c.key] || 0,
      差额: (budgets[c.key] || 0) - (totalsByCategory[c.key] || 0),
    }));
    XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(budgetRows, "暂无预算数据"), "预算");

    // 3. cash flow timeline
    const cashflowRows = cashflowTimeline.map(r => ({
      日期: r.date,
      项目: r.label,
      金额: r.amount,
      累计余额: r.running,
    }));
    XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(cashflowRows, "本月暂无现金流记录"), "现金流");

    // 4. transfers
    const transferRows = monthTransfers.map(t => ({
      日期: t.date,
      方向: t.direction === "in" ? "转入" : "转出",
      对方: t.person,
      金额: t.amount,
      计入支出: t.countAsExpense && t.category ? (CAT_MAP[t.category]?.label || t.category) : "否",
      备注: t.note || "",
    }));
    XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(transferRows, "本月暂无转账记录"), "转账");

    // 5. funds
    const fundRows = savingsGoals.map(g => ({
      基金名称: g.name,
      已存: g.saved,
      目标: g.target,
      进度: g.target > 0 ? `${Math.round((g.saved / g.target) * 100)}%` : "",
    }));
    XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(fundRows, "还没有基金"), "基金");

    // 6. net worth snapshot
    const netWorthRows = [
      ...assets.map(a => ({ 类型: "资产", 名称: a.name, 分类: ASSET_CAT_MAP[a.category]?.label || a.category, 金额: a.value })),
      ...liabilities.map(l => ({ 类型: "负债", 名称: l.name, 分类: "", 金额: l.value })),
      { 类型: "汇总", 名称: "净资产", 分类: "", 金额: netWorth },
    ];
    XLSX.utils.book_append_sheet(wb, sheetOrPlaceholder(netWorthRows, "还没有资产/负债数据"), "资产负债");

    XLSX.writeFile(wb, `茜茜的小钱包_${selectedMonth}.xlsx`);
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F5DFDA",
      backgroundImage:
        "repeating-linear-gradient(0deg, rgba(74,118,144,0.035) 0px, rgba(74,118,144,0.035) 1px, transparent 1px, transparent 28px)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
      color: "#4A7690",
      padding: "24px 16px 60px",
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap" />
      <style>{`
        * { box-sizing: border-box; }
        input, button, select { min-width: 0; box-sizing: border-box; }
        input[type="number"] { width: 100%; }

        button { transition: transform 0.12s ease, opacity 0.12s ease, filter 0.15s ease, box-shadow 0.15s ease; }
        button:active { transform: scale(0.95); opacity: 0.85; }
        @media (hover: hover) {
          button:hover { filter: brightness(0.96); }
        }
        input[type="text"], input[type="number"], input[type="date"], input[type="month"] {
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        input[type="text"]:focus, input[type="number"]:focus, input[type="date"]:focus, input[type="month"]:focus {
          border-color: #4A7690 !important;
          box-shadow: 0 0 0 3px rgba(74,118,144,0.14);
        }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #E8BFB8; border-radius: 4px; }
      `}</style>

      <div style={{ maxWidth: 480, margin: "0 auto", boxShadow: "0 6px 28px rgba(74,118,144,0.14)", borderRadius: 10 }}>

        {/* Header - chiikawa cover */}
        <div style={{
          background: "linear-gradient(135deg, #4A7690 0%, #3D5F72 100%)",
          color: "#F5DFDA",
          borderRadius: "20px 20px 6px 6px",
          padding: "22px 20px",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 8px 20px -8px rgba(74,118,144,0.5)",
        }}>
          {/* mascot watermark */}
          <div style={{
            position: "absolute", top: -14, right: -6, fontSize: 100,
            opacity: 0.18, transform: "rotate(10deg)", lineHeight: 1,
          }}>
            ⚽
          </div>
          <div style={{
            position: "absolute", top: 16, right: 90, width: 26, height: 26, borderRadius: "50%",
            background: "rgba(245,223,218,0.25)",
          }} />
          <div style={{
            position: "absolute", top: 46, right: 60, width: 14, height: 14, borderRadius: "50%",
            background: "rgba(245,223,218,0.2)",
          }} />

          <div style={{ fontSize: 11, letterSpacing: 3, opacity: 0.7, marginBottom: 4 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>CHIIKAWA LEDGER</span> · 月度账本
          </div>
          <div style={{ fontWeight: 700, fontSize: 26, lineHeight: 1.3, display: "flex", alignItems: "center", gap: 8 }}>
            茜茜的小钱包 <span style={{ fontSize: 20 }}>⚽</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            <button onClick={() => shiftMonth(-1)} style={navBtnStyle}>‹</button>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, letterSpacing: 1, minWidth: 90, textAlign: "center" }}>
              {selectedMonth}
            </div>
            <button onClick={() => shiftMonth(1)} style={navBtnStyle}>›</button>
          </div>
        </div>

        {/* Tab navigation */}
        <div style={{ display: "flex", flexWrap: "wrap", background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: 4, gap: 4 }}>
          {[
            { key: "quickadd", label: "记一笔" },
            { key: "ledger", label: "账本" },
            { key: "trend", label: "趋势" },
            { key: "assets", label: "资产管理" },
            { key: "funds", label: "基金管理" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                flex: "1 1 auto", minWidth: 62, padding: "9px 0", border: "none", cursor: "pointer", borderRadius: 12,
                fontSize: 13, fontWeight: activeTab === t.key ? 700 : 500,
                color: activeTab === t.key ? "#FFFFFF" : "#5F7A8C",
                background: activeTab === t.key ? "#4A7690" : "transparent",
                boxShadow: activeTab === t.key ? "0 2px 6px rgba(74,118,144,0.35)" : "none",
                transition: "all 0.18s ease",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Export report */}
        <button
          onClick={exportMonthlyExcel}
          style={{
            width: "100%", background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none",
            padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            cursor: "pointer", fontSize: 12.5, color: "#2E4356", fontWeight: 600,
          }}
        >
          <Download size={14} />
          导出 {selectedMonth} Excel 报表
        </button>

        {activeTab === "ledger" && (
        <>

        {/* Income setup */}
        <div style={{
          background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none",
          padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        }}>
          <div>
            <div style={{ fontSize: 13, color: "#2E4356", display: "flex", alignItems: "center", gap: 6 }}>
              <Wallet size={14} />
              每次发薪(15/30日)
            </div>
            <div style={{ fontSize: 10.5, color: "#5F7A8C", marginTop: 2 }}>
              {selectedMonth}，每月单独填写
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>$</span>
            <input
              type="number"
              placeholder="金额"
              value={payAmount ?? ""}
              onChange={e => updatePayAmount(e.target.value === "" ? null : parseFloat(e.target.value))}
              style={{
                width: 90, border: "none", borderBottom: "1px solid #E8BFB8", background: "transparent",
                fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textAlign: "right", outline: "none", padding: "2px 0",
              }}
            />
          </div>
        </div>

        {/* Rent setup — varies month to month; editing only changes the selected month */}
        <div style={{
          background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none",
          padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: 13, color: "#2E4356", display: "flex", alignItems: "center", gap: 6 }}>
              <Wallet size={14} />
              房租（{selectedMonth}，走现金流）
            </div>
            <div style={{ fontSize: 10.5, color: "#5F7A8C", marginTop: 2 }}>
              每月单独填写，不影响其他月份
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="number"
                placeholder="日期"
                value={rent.day ?? ""}
                onChange={e => updateRent("day", e.target.value === "" ? null : parseInt(e.target.value, 10))}
                style={{
                  width: 44, border: "none", borderBottom: "1px solid #E8BFB8", background: "transparent",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textAlign: "right", outline: "none", padding: "2px 0",
                }}
              />
              <span style={{ fontSize: 12, color: "#2E4356" }}>日</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>$</span>
              <input
                type="number"
                placeholder="金额"
                value={rent.amount ?? ""}
                onChange={e => updateRent("amount", e.target.value === "" ? null : parseFloat(e.target.value))}
                style={{
                  width: 90, border: "none", borderBottom: "1px solid #E8BFB8", background: "transparent",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textAlign: "right", outline: "none", padding: "2px 0",
                }}
              />
            </div>
          </div>
        </div>

        {/* Summary strip - stamped ledger balance */}
        <div style={{
          background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none",
          padding: "18px 18px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
        }}>
          <SummaryCell icon={<TrendingUp size={13} />} label="本月收入" value={monthlyIncome} tone="#5C8F5C" />
          <SummaryCell icon={<TrendingDown size={13} />} label="本月支出" value={totalSpent} tone="#C85647" />
          <div style={{ gridColumn: "1 / -1", borderTop: "1px dashed #E8BFB8", paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 12, color: "#2E4356", letterSpacing: 1 }}>结余 BALANCE</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 22,
              color: balance >= 0 ? "#4A7690" : "#C85647",
            }}>
              {balance >= 0 ? "" : "-"}${formatMoney(Math.abs(balance))}
            </span>
          </div>
        </div>

        {/* Chart */}
        {pieData.length > 0 && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: "10px 8px 4px" }}>
            <div style={{ height: 190 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={3}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} stroke="#FFFFFF" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `$${formatMoney(v)}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", justifyContent: "center", paddingBottom: 10, fontSize: 12 }}>
              {pieData.map(d => (
                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, color: "#2E4356" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: "inline-block" }} />
                  {d.name} ${formatMoney(d.value)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Budget planning — synced with the ledger's category spending for the selected month */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: "16px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <div style={{ fontSize: 12.5, color: "#2E4356", letterSpacing: 1, fontWeight: 700 }}>
              预算 · {selectedMonth}
            </div>
            {totalBudget > 0 && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#2E4356" }}>
                ${formatMoney(budgetableSpent)} / ${formatMoney(totalBudget)}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "#5F7A8C" }}>
              {hasPrevMonthData
                ? `根据 ${prevMonthKey} 的支出生成下个月预算`
                : `${prevMonthKey} 暂无支出记录，可手动填写预算`}
            </div>
            <button
              onClick={generateBudgetFromPrevMonth}
              disabled={!hasPrevMonthData}
              style={{
                background: hasPrevMonthData ? "#4A7690" : "#F3CFC7",
                color: hasPrevMonthData ? "#F5DFDA" : "#E8BFB8",
                border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600,
                cursor: hasPrevMonthData ? "pointer" : "not-allowed", flexShrink: 0,
              }}
            >
              一键生成
            </button>
          </div>

          <div style={{ fontSize: 10.5, color: "#5F7A8C", marginBottom: 10 }}>
            订阅、基金、水电有各自的管理页面，不计入这里的预算
          </div>

          {BUDGET_CATEGORIES.map(c => {
            const spent = totalsByCategory[c.key] || 0;
            const budget = budgets[c.key] || 0;
            const pct = budget > 0 ? Math.max(0, Math.min(100, (spent / budget) * 100)) : 0;
            const over = budget > 0 && spent > budget;
            const barColor = over ? "#C85647" : pct >= 80 ? "#E89494" : "#5C8F5C";
            return (
              <div key={c.key} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.label}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: over ? "#C85647" : "#4A7690", fontWeight: 600 }}>
                      ${formatMoney(spent)}
                    </span>
                    <span style={{ fontSize: 11, color: "#5F7A8C" }}>/</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>$</span>
                    <input
                      type="number"
                      placeholder="0"
                      value={budgets[c.key] ?? ""}
                      onChange={e => updateBudget(c.key, e.target.value)}
                      style={{
                        width: 56, border: "none", borderBottom: "1px solid #E8BFB8", background: "transparent",
                        fontFamily: "'JetBrains Mono', monospace", fontSize: 12, textAlign: "right", outline: "none", padding: "1px 0",
                      }}
                    />
                  </div>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: "#F3CFC7", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${budget > 0 ? pct : 0}%`, background: barColor, borderRadius: 4, transition: "width 0.3s" }} />
                </div>
                {over && (
                  <div style={{ fontSize: 10.5, color: "#C85647", marginTop: 3 }}>
                    超出预算 ${formatMoney(spent - budget)}
                  </div>
                )}
              </div>
            );
          })}

          {recurringTotal > 0 && (
            <div style={{ borderTop: "1px dashed #E8BFB8", paddingTop: 10, marginTop: 4, fontSize: 11.5, color: "#5F7A8C", display: "flex", justifyContent: "space-between" }}>
              <span>订阅/自动扣款（不计入分类预算）</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>${formatMoney(recurringTotal)}</span>
            </div>
          )}

          <div style={{ borderTop: "1px dashed #E8BFB8", paddingTop: 12, marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "#5F7A8C", marginBottom: 8 }}>管理分类</div>
            {customCategories.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                {customCategories.map(c => (
                  <div key={c.key} style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20,
                    border: `1.5px solid ${c.color}`, fontSize: 12,
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: c.color }} />
                    {c.label}
                    <button
                      onClick={() => removeCategory(c.key)}
                      style={{ border: "none", background: "none", color: "#5F7A8C", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="新分类名称，如 宠物"
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: 1, outline: "none" }}
              />
              <button
                onClick={() => addCategory()}
                style={{
                  background: "#4A7690", color: "#FFFFFF", border: "none", borderRadius: 8,
                  padding: "0 14px", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                  boxShadow: "0 2px 6px rgba(74,118,144,0.4)",
                }}
              >
                <Plus size={14} /> 添加
              </button>
            </div>
            {categoryError && <div style={{ color: "#C85647", fontSize: 11, marginTop: 6 }}>{categoryError}</div>}
          </div>
        </div>

        {/* Credit card cash flow planning */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, color: "#2E4356", letterSpacing: 1, marginBottom: 10, fontWeight: 700 }}>
            信用卡还款 · 现金流规划
          </div>

          {/* existing cards */}
          {cards.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {cards.map(c => {
                const currentAmount = getCardAmount(c, selectedMonth);
                const isEditing = editingCardId === c.id;
                return (
                  <div key={c.id} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                    border: "1px solid #F3CFC7", borderRadius: 8, marginBottom: 6, background: "#F7E1DB",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: "#E89494", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "#5F7A8C" }}>
                        本月已刷 ${formatMoney(totalsByCard[c.id] || 0)}
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#5F7A8C", flexShrink: 0 }}>每月{c.dueDay}日</div>

                    {isEditing ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>$</span>
                          <input
                            type="number"
                            autoFocus
                            value={editAmountInput}
                            onChange={e => setEditAmountInput(e.target.value)}
                            style={{
                              width: 64, border: "none", borderBottom: "1px solid #E89494", background: "transparent",
                              fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "right", outline: "none", padding: "1px 0",
                            }}
                          />
                        </div>
                        <button
                          onClick={() => {
                            const v = parseFloat(editAmountInput);
                            if (!isNaN(v) && v >= 0) updateCardAmount(c.id, selectedMonth, v);
                            setEditingCardId(null);
                          }}
                          style={{ border: "none", background: "#5C8F5C", color: "#FFFFFF", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                        >
                          存
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, flexShrink: 0, minWidth: 56, textAlign: "right" }}>
                          ${formatMoney(currentAmount)}
                        </div>
                        <button
                          onClick={() => { setEditingCardId(c.id); setEditAmountInput(String(currentAmount)); }}
                          style={{ border: "none", background: "none", color: "#5F7A8C", cursor: "pointer", padding: 2, flexShrink: 0 }}
                          title="修改本月还款金额"
                        >
                          <Pencil size={13} />
                        </button>
                      </>
                    )}

                    <button onClick={() => removeCard(c.id)} style={{ border: "none", background: "none", color: "#E8BFB8", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* add card form */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="卡片名称"
              value={cardForm.name}
              onChange={e => setCardForm({ ...cardForm, name: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 90px", outline: "none" }}
            />
            <input
              type="number"
              placeholder="还款日"
              value={cardForm.dueDay}
              onChange={e => setCardForm({ ...cardForm, dueDay: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 60px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
            <input
              type="number"
              placeholder="金额"
              value={cardForm.amount}
              onChange={e => setCardForm({ ...cardForm, amount: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 70px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
            <button
              onClick={addCard}
              style={{
                background: "#E89494", color: "#FFFFFF", border: "none", borderRadius: 8,
                padding: "0 12px", display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0,
                boxShadow: "0 2px 6px rgba(232,148,148,0.4)",
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          {cardError && <div style={{ color: "#C85647", fontSize: 12, marginBottom: 10 }}>{cardError}</div>}

          <div style={{ marginBottom: 12 }}>
            <LabeledInput label="月初起始余额（可选，每月单独）" value={startBalance} onChange={v => updateStartBalance(v)} placeholder="0.00" prefix="$" />
          </div>

          {ccWarnings.length > 0 && (
            <div style={{
              background: "rgba(200,86,71,0.08)", border: "1px solid #C85647", borderRadius: 8,
              padding: "10px 12px", fontSize: 12.5, color: "#C85647", marginBottom: 12, fontWeight: 500,
            }}>
              {ccWarnings.map((w, i) => (
                <div key={i}>⚠ {w.date} {w.label}时，账户预计缺口 ${formatMoney(Math.abs(w.running))}</div>
              ))}
            </div>
          )}

          {cashflowTimeline.length > 0 && (
            <div>
              {cashflowTimeline.map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                  borderTop: i === 0 ? "none" : "1px dashed #F3CFC7",
                  background: r.type === "cc" ? "rgba(232,148,148,0.08)" : "transparent",
                }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#5F7A8C", width: 68, flexShrink: 0 }}>
                    {r.date.slice(5)}
                  </div>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: (r.type === "income" || (r.type === "transfer" && r.amount >= 0)) ? "#5C8F5C"
                      : (r.type === "cc" || r.type === "saving" || r.type === "rent") ? "#E89494" : "#C85647",
                  }} />
                  <div style={{ flex: 1, fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.label}
                  </div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, width: 66, textAlign: "right", flexShrink: 0,
                    color: r.amount >= 0 ? "#5C8F5C" : "#C85647",
                  }}>
                    {r.amount >= 0 ? "+" : "-"}${formatMoney(Math.abs(r.amount))}
                  </div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, width: 78, textAlign: "right", flexShrink: 0,
                    color: r.running >= 0 ? "#4A7690" : "#C85647",
                  }}>
                    {r.running >= 0 ? "" : "-"}${formatMoney(Math.abs(r.running))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {cashflowTimeline.length === 0 && (
            <div style={{ fontSize: 12, color: "#5F7A8C", textAlign: "center", padding: "8px 0" }}>
              填写工资和信用卡信息后，这里会显示现金流时间线
            </div>
          )}
        </div>

        {/* Transfers */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: "16px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: "#2E4356", letterSpacing: 1, fontWeight: 700 }}>
              转账
            </div>
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: netTransfers >= 0 ? "#5C8F5C" : "#C85647",
            }}>
              净额 <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{netTransfers >= 0 ? "+" : "-"}${formatMoney(Math.abs(netTransfers))}</span>
            </div>
          </div>

          {monthTransfers.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {monthTransfers.map(t => (
                <div key={t.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  border: "1px solid #F3CFC7", borderRadius: 8, marginBottom: 6, background: "#F7E1DB",
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                    background: t.direction === "in" ? "#5C8F5C" : "#C85647",
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.person}{t.note && <span style={{ color: "#5F7A8C", fontWeight: 400 }}> · {t.note}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#5F7A8C", fontFamily: "'JetBrains Mono', monospace", display: "flex", gap: 6, alignItems: "center" }}>
                      <span>{t.date}</span>
                      {t.countAsExpense && t.category && (
                        <span style={{
                          background: "rgba(200,86,71,0.12)", color: "#C85647", padding: "1px 6px",
                          borderRadius: 10, fontSize: 10.5, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
                        }}>
                          计入支出 · {CAT_MAP[t.category]?.label}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, flexShrink: 0,
                    color: t.direction === "in" ? "#5C8F5C" : "#C85647",
                  }}>
                    {t.direction === "in" ? "+" : "-"}${formatMoney(t.amount)}
                  </div>
                  <button onClick={() => removeTransfer(t.id)} style={{ border: "none", background: "none", color: "#E8BFB8", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => setTransferForm({ ...transferForm, direction: "in" })}
              style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer", flex: 1,
                border: `1.5px solid ${transferForm.direction === "in" ? "#5C8F5C" : "#E8BFB8"}`,
                background: transferForm.direction === "in" ? "#5C8F5C" : "transparent",
                color: transferForm.direction === "in" ? "#FFFFFF" : "#4A7690",
                fontWeight: transferForm.direction === "in" ? 700 : 400,
              }}
            >
              别人转给我
            </button>
            <button
              onClick={() => setTransferForm({ ...transferForm, direction: "out" })}
              style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer", flex: 1,
                border: `1.5px solid ${transferForm.direction === "out" ? "#C85647" : "#E8BFB8"}`,
                background: transferForm.direction === "out" ? "#C85647" : "transparent",
                color: transferForm.direction === "out" ? "#FFFFFF" : "#4A7690",
                fontWeight: transferForm.direction === "out" ? 700 : 400,
              }}
            >
              我转给别人
            </button>
          </div>

          {transferForm.direction === "out" && (
            <div style={{ marginBottom: 8 }}>
              <button
                onClick={() => setTransferForm({ ...transferForm, countAsExpense: !transferForm.countAsExpense })}
                style={{
                  padding: "6px 14px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                  border: `1.5px solid ${transferForm.countAsExpense ? "#C85647" : "#E8BFB8"}`,
                  background: transferForm.countAsExpense ? "#C85647" : "transparent",
                  color: transferForm.countAsExpense ? "#FFFFFF" : "#4A7690",
                  fontWeight: transferForm.countAsExpense ? 700 : 400,
                }}
              >
                计入本月支出
              </button>
              <div style={{ fontSize: 10.5, color: "#5F7A8C", marginTop: 5 }}>
                比如别人先帮你代付、你转账还给对方，这笔就是你的真实支出
              </div>
              {transferForm.countAsExpense && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {CATEGORIES.map(c => (
                    <button
                      key={c.key}
                      onClick={() => setTransferForm({ ...transferForm, category: c.key })}
                      style={{
                        padding: "5px 11px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                        border: `1.5px solid ${transferForm.category === c.key ? c.color : "#E8BFB8"}`,
                        background: transferForm.category === c.key ? c.color : "transparent",
                        color: transferForm.category === c.key ? "#FFFFFF" : "#4A7690",
                        fontWeight: transferForm.category === c.key ? 700 : 400,
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="对方姓名"
              value={transferForm.person}
              onChange={e => setTransferForm({ ...transferForm, person: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 100px", outline: "none" }}
            />
            <input
              type="number"
              placeholder="金额"
              value={transferForm.amount}
              onChange={e => setTransferForm({ ...transferForm, amount: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 70px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
            <input
              type="date"
              value={transferForm.date}
              onChange={e => setTransferForm({ ...transferForm, date: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12, flex: "1 1 120px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="备注（可选）"
              value={transferForm.note}
              onChange={e => setTransferForm({ ...transferForm, note: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: 1, outline: "none" }}
            />
            <button
              onClick={addTransfer}
              style={{
                background: "#4A7690", color: "#F5DFDA", border: "none", borderRadius: 8,
                padding: "0 14px", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
              }}
            >
              <Plus size={14} /> 记录
            </button>
          </div>
          {transferError && <div style={{ color: "#C85647", fontSize: 12, marginTop: 6 }}>{transferError}</div>}
        </div>

        {/* Recurring subscriptions / auto-deducted expenses */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, color: "#2E4356", letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>
            订阅 / 自动扣款
          </div>
          <div style={{ fontSize: 11, color: "#5F7A8C", marginBottom: 10 }}>
            添加一次，每月会自动计入支出总额，不用每月手动记账
          </div>

          {recurringExpenses.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {recurringExpenses.map(r => {
                const currentAmount = getRecurringAmount(r, selectedMonth);
                const isEditing = editingRecurringId === r.id;
                const isEnded = !!(r.endMonth && selectedMonth > r.endMonth);
                return (
                  <div key={r.id} style={{
                    border: "1px solid #F3CFC7", borderRadius: 8, marginBottom: 6, background: isEnded ? "#FFFFFF" : "#F7E1DB",
                    padding: "8px 10px", opacity: isEnded ? 0.75 : 1,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: isEnded ? "#E8BFB8" : "#7FA3B8" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: "#5F7A8C" }}>
                          {r.frequency === "yearly" ? "每年" : "每月"}{r.day}日
                          {r.startMonth && ` · 自${r.startMonth}起`}
                          {isEnded && ` · 已于${r.endMonth}结束`}
                          {!isEnded && r.endMonth && ` · 将于${r.endMonth}后结束`}
                          {r.cardId && cards.find(c => c.id === r.cardId) && ` · ${cards.find(c => c.id === r.cardId).name}`}
                        </div>
                      </div>

                      {isEditing ? (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>$</span>
                            <input
                              type="number"
                              autoFocus
                              value={editRecurringAmountInput}
                              onChange={e => setEditRecurringAmountInput(e.target.value)}
                              style={{
                                width: 64, border: "none", borderBottom: "1px solid #7FA3B8", background: "transparent",
                                fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "right", outline: "none", padding: "1px 0",
                              }}
                            />
                          </div>
                          <button
                            onClick={() => {
                              const v = parseFloat(editRecurringAmountInput);
                              if (!isNaN(v) && v >= 0) updateRecurringAmount(r.id, selectedMonth, v);
                              setEditingRecurringId(null);
                            }}
                            style={{ border: "none", background: "#5C8F5C", color: "#FFFFFF", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                          >
                            存
                          </button>
                        </>
                      ) : (
                        <>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                            ${formatMoney(currentAmount)}
                          </div>
                          {!isEnded && (
                            <button
                              onClick={() => { setEditingRecurringId(r.id); setEditRecurringAmountInput(String(currentAmount)); }}
                              style={{ border: "none", background: "none", color: "#5F7A8C", cursor: "pointer", padding: 2, flexShrink: 0 }}
                              title="修改本月金额"
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 6 }}>
                      {isEnded ? (
                        <button
                          onClick={() => reactivateRecurring(r.id)}
                          style={{ border: "none", background: "none", color: "#5C8F5C", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}
                        >
                          恢复订阅
                        </button>
                      ) : (
                        <button
                          onClick={() => endRecurring(r.id, selectedMonth)}
                          style={{ border: "none", background: "none", color: "#E89494", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}
                        >
                          结束订阅（{selectedMonth}后不再自动扣款）
                        </button>
                      )}
                      <button
                        onClick={() => removeRecurring(r.id)}
                        style={{ border: "none", background: "none", color: "#E8BFB8", cursor: "pointer", fontSize: 11, padding: 0 }}
                        title="彻底删除，包括历史月份的记录"
                      >
                        彻底删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {cards.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#5F7A8C", marginBottom: 6 }}>用哪张卡自动扣款（可选）</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {cards.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setRecurringForm({ ...recurringForm, cardId: recurringForm.cardId === c.id ? "" : c.id })}
                    style={{
                      padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                      border: `1.5px solid ${recurringForm.cardId === c.id ? "#E89494" : "#E8BFB8"}`,
                      background: recurringForm.cardId === c.id ? "#E89494" : "transparent",
                      color: recurringForm.cardId === c.id ? "#FFFFFF" : "#4A7690",
                      fontWeight: recurringForm.cardId === c.id ? 700 : 400,
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => setRecurringForm({ ...recurringForm, frequency: "monthly" })}
              style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer", flex: 1,
                border: `1.5px solid ${recurringForm.frequency === "monthly" ? "#4A7690" : "#E8BFB8"}`,
                background: recurringForm.frequency === "monthly" ? "#4A7690" : "transparent",
                color: recurringForm.frequency === "monthly" ? "#FFFFFF" : "#4A7690",
                fontWeight: recurringForm.frequency === "monthly" ? 700 : 400,
              }}
            >
              每月一次
            </button>
            <button
              onClick={() => setRecurringForm({ ...recurringForm, frequency: "yearly" })}
              style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer", flex: 1,
                border: `1.5px solid ${recurringForm.frequency === "yearly" ? "#4A7690" : "#E8BFB8"}`,
                background: recurringForm.frequency === "yearly" ? "#4A7690" : "transparent",
                color: recurringForm.frequency === "yearly" ? "#FFFFFF" : "#4A7690",
                fontWeight: recurringForm.frequency === "yearly" ? 700 : 400,
              }}
            >
              每年一次
            </button>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#5F7A8C", marginBottom: 6 }}>开始时间（之前的月份不会受影响）</div>
            <input
              type="month"
              value={recurringForm.startMonth}
              onChange={e => setRecurringForm({ ...recurringForm, startMonth: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace", outline: "none", width: "100%" }}
            />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="名称，如 Netflix"
              value={recurringForm.name}
              onChange={e => setRecurringForm({ ...recurringForm, name: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 110px", outline: "none" }}
            />
            <input
              type="number"
              placeholder="扣款日"
              value={recurringForm.day}
              onChange={e => setRecurringForm({ ...recurringForm, day: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 60px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
            <input
              type="number"
              placeholder="金额"
              value={recurringForm.amount}
              onChange={e => setRecurringForm({ ...recurringForm, amount: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 70px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
            <button
              onClick={addRecurring}
              style={{
                background: "#4A7690", color: "#F5DFDA", border: "none", borderRadius: 8,
                padding: "0 12px", display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0,
                boxShadow: "0 2px 6px rgba(74,118,144,0.35)",
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          {recurringError && <div style={{ color: "#C85647", fontSize: 12 }}>{recurringError}</div>}
        </div>
        </>
        )}

        {activeTab === "quickadd" && (
        <>
        {/* Quick add — numeric keypad entry */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", borderRadius: "4px 4px 20px 20px", padding: 16, position: "relative" }}>
          {stampFlash && (
            <div style={{
              position: "absolute", top: 8, right: 14, color: "#C85647", border: "2px solid #C85647",
              borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 1,
              transform: "rotate(-8deg)", opacity: 0.9,
              animation: "stampIn 0.5s ease-out", zIndex: 2,
            }}>⚽ 已记录</div>
          )}
          <style>{`@keyframes stampIn { 0% { opacity:0; transform: rotate(-8deg) scale(1.6);} 100% {opacity:0.9; transform: rotate(-8deg) scale(1);} }`}</style>

          <div style={{ marginBottom: 10 }}>
            <button
              onClick={() => setForm({ ...form, isRefund: !form.isRefund, fundId: "" })}
              style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                border: `1.5px solid ${form.isRefund ? "#5C8F5C" : "#E8BFB8"}`,
                background: form.isRefund ? "#5C8F5C" : "transparent",
                color: form.isRefund ? "#FFFFFF" : "#4A7690",
                fontWeight: form.isRefund ? 700 : 400,
                transition: "all 0.15s",
              }}
            >
              ↩ 这是一笔退款
            </button>
            {form.isRefund && (
              <div style={{ fontSize: 10.5, color: "#5F7A8C", marginTop: 5 }}>
                退款会退回信用卡，减少本月对应分类和该卡的支出，不影响现金流
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: showAddCategory ? 8 : 10 }}>
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                onClick={() => setForm({ ...form, category: c.key })}
                style={{
                  padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                  border: `1.5px solid ${form.category === c.key ? c.color : "#E8BFB8"}`,
                  background: form.category === c.key ? c.color : "transparent",
                  color: form.category === c.key ? "#FFFFFF" : "#4A7690",
                  fontWeight: form.category === c.key ? 700 : 400,
                  transition: "all 0.15s",
                }}
              >
                {c.label}
              </button>
            ))}
            <button
              onClick={() => setShowAddCategory(!showAddCategory)}
              style={{
                padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                border: "1.5px dashed #5F7A8C", background: "transparent", color: "#5F7A8C",
                display: "flex", alignItems: "center", gap: 3,
              }}
            >
              <Plus size={12} /> 新增分类
            </button>
          </div>

          {showAddCategory && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input
                type="text"
                placeholder="分类名称，如 宠物"
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                autoFocus
                style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: 1, outline: "none" }}
              />
              <button
                onClick={() => addCategory(key => setForm(prev => ({ ...prev, category: key })))}
                style={{
                  background: "#4A7690", color: "#FFFFFF", border: "none", borderRadius: 8,
                  padding: "0 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  boxShadow: "0 2px 6px rgba(74,118,144,0.4)",
                }}
              >
                添加
              </button>
            </div>
          )}
          {showAddCategory && categoryError && (
            <div style={{ color: "#C85647", fontSize: 11, marginTop: -6, marginBottom: 10 }}>{categoryError}</div>
          )}

          {cards.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: form.isRefund ? "#C85647" : "#5F7A8C", marginBottom: 6 }}>
                {form.isRefund ? "退到哪张卡（必选）" : "用哪张卡支付"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {cards.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setForm({ ...form, cardId: form.cardId === c.id ? "" : c.id })}
                    style={{
                      padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                      border: `1.5px solid ${form.cardId === c.id ? "#E89494" : "#E8BFB8"}`,
                      background: form.cardId === c.id ? "#E89494" : "transparent",
                      color: form.cardId === c.id ? "#FFFFFF" : "#4A7690",
                      fontWeight: form.cardId === c.id ? 700 : 400,
                      transition: "all 0.15s",
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!form.isRefund && form.category === "fund" && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#5F7A8C", marginBottom: 6 }}>从哪个基金支出（会自动扣减该基金的已存金额）</div>
              {savingsGoals.length === 0 ? (
                <div style={{ fontSize: 12, color: "#C85647" }}>
                  还没有基金，先去"基金管理"里创建一个
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {savingsGoals.map(g => (
                    <button
                      key={g.id}
                      onClick={() => setForm({ ...form, fundId: form.fundId === g.id ? "" : g.id })}
                      style={{
                        padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                        border: `1.5px solid ${form.fundId === g.id ? "#745E92" : "#E8BFB8"}`,
                        background: form.fundId === g.id ? "#745E92" : "transparent",
                        color: form.fundId === g.id ? "#FFFFFF" : "#4A7690",
                        fontWeight: form.fundId === g.id ? 700 : 400,
                        transition: "all 0.15s",
                      }}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="date"
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "8px 10px", fontSize: 13, flex: "0 0 140px", fontFamily: "'JetBrains Mono', monospace", color: "#4A7690" }}
            />
            <input
              type="text"
              placeholder="备注（可选）"
              value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "8px 10px", fontSize: 13, flex: 1, outline: "none" }}
            />
          </div>

          {/* amount display */}
          <div style={{
            background: "#F7E1DB", border: "1px solid #E8BFB8", borderRadius: 12, padding: "16px 18px",
            marginBottom: 10, display: "flex", alignItems: "baseline", justifyContent: "space-between",
          }}>
            <button
              onClick={() => pressKeypad("clear")}
              style={{ border: "none", background: "none", color: "#C85647", fontSize: 12, cursor: "pointer", padding: 0 }}
            >
              清空
            </button>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 32, fontWeight: 700,
              color: form.amount ? "#4A7690" : "#E8BFB8", lineHeight: 1.2,
            }}>
              ${form.amount || "0"}
            </div>
          </div>

          {/* numeric keypad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
            {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"].map(k => (
              <button
                key={k}
                onClick={() => pressKeypad(k)}
                style={{
                  padding: "16px 0", borderRadius: 12, border: "1px solid #E8BFB8",
                  background: k === "back" ? "#F7E1DB" : "#FFFFFF",
                  color: "#4A7690",
                  fontSize: 18, fontWeight: 700, cursor: "pointer",
                  fontFamily: k === "back" ? "inherit" : "'JetBrains Mono', monospace",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {k === "back" ? "⌫" : k}
              </button>
            ))}
          </div>

          {/* shared/reimbursed portion — e.g. you fronted the bill for a friend */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#5F7A8C", marginBottom: 6 }}>
              有人分摊这笔钱吗？（比如帮朋友代付，之后对方会转账还你）
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", flex: 1, border: "1px solid #E8BFB8", borderRadius: 8, padding: "8px 10px" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginRight: 4, color: "#2E4356" }}>$</span>
                <input
                  type="number"
                  placeholder="不计入支出的金额（可选）"
                  value={form.excludedAmount}
                  onChange={e => setForm({ ...form, excludedAmount: e.target.value })}
                  style={{ border: "none", outline: "none", width: "100%", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, background: "transparent" }}
                />
              </div>
            </div>
            {parseFloat(form.excludedAmount) > 0 && parseFloat(form.amount) > 0 && (
              <div style={{ fontSize: 11, color: "#5C8F5C", marginTop: 5 }}>
                实际计入本月支出：${formatMoney(Math.max(0, parseFloat(form.amount) - parseFloat(form.excludedAmount)))}
                （信用卡还是会算刷了 ${formatMoney(parseFloat(form.amount))} 的全额）
              </div>
            )}
          </div>

          <button
            onClick={addEntry}
            style={{
              width: "100%", background: "#4A7690", color: "#F5DFDA", border: "none", borderRadius: 12,
              padding: "14px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              cursor: "pointer", fontSize: 15, fontWeight: 700,
              boxShadow: "0 2px 6px rgba(74,118,144,0.35)",
            }}
          >
            <Plus size={17} /> 记一笔
          </button>
          {error && <div style={{ color: "#C85647", fontSize: 12, marginTop: 8, textAlign: "center" }}>{error}</div>}
        </div>
        </>
        )}

        {activeTab === "ledger" && (
        <>

        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", borderRadius: "4px 4px 20px 20px", overflow: "hidden" }}>
          {monthEntries.length === 0 ? (
            <div style={{ padding: "30px 18px", textAlign: "center", color: "#5F7A8C", fontSize: 13 }}>
              这个月还没有记录，记下第一笔支出吧
            </div>
          ) : (
            monthEntries.map((e, idx) => (
              <div key={e.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
                borderTop: idx === 0 ? "none" : "1px dashed #F3CFC7",
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: e.isRefund ? "#5C8F5C" : e.recurring ? "#7FA3B8" : (CAT_MAP[e.category]?.color || "#5F7A8C"), flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                    {e.recurring ? "订阅" : (CAT_MAP[e.category]?.label || "已删除的分类")}
                    {e.note && <span style={{ color: "#5F7A8C", fontWeight: 400 }}> · {e.note}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#5F7A8C", fontFamily: "'JetBrains Mono', monospace", display: "flex", gap: 6, alignItems: "center" }}>
                    <span>{e.date}</span>
                    {e.cardId && cards.find(c => c.id === e.cardId) && (
                      <span style={{
                        background: "rgba(232,148,148,0.15)", color: "#8A5A2A", padding: "1px 6px",
                        borderRadius: 10, fontSize: 10.5, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
                      }}>
                        {cards.find(c => c.id === e.cardId).name}
                      </span>
                    )}
                    {e.fundId && savingsGoals.find(g => g.id === e.fundId) && (
                      <span style={{
                        background: "rgba(116,94,146,0.15)", color: "#745E92", padding: "1px 6px",
                        borderRadius: 10, fontSize: 10.5, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
                      }}>
                        ← {savingsGoals.find(g => g.id === e.fundId).name}
                      </span>
                    )}
                    {e.recurring && (
                      <span style={{
                        background: "rgba(127,163,184,0.18)", color: "#52443C", padding: "1px 6px",
                        borderRadius: 10, fontSize: 10.5, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
                      }}>
                        订阅自动扣款
                      </span>
                    )}
                    {e.isRefund && (
                      <span style={{
                        background: "rgba(47,107,79,0.15)", color: "#5C8F5C", padding: "1px 6px",
                        borderRadius: 10, fontSize: 10.5, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
                      }}>
                        退款
                      </span>
                    )}
                    {e.excludedAmount > 0 && (
                      <span style={{
                        background: "rgba(47,107,79,0.15)", color: "#5C8F5C", padding: "1px 6px",
                        borderRadius: 10, fontSize: 10.5, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
                      }}>
                        他人分摊 ${formatMoney(e.excludedAmount)}
                      </span>
                    )}
                  </div>
                  {e.excludedAmount > 0 && (
                    <div style={{ fontSize: 10.5, color: "#5F7A8C", marginTop: 2 }}>
                      共 ${formatMoney(e.amount)}，计入支出 ${formatMoney(e.amount - e.excludedAmount)}
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, color: e.isRefund ? "#5C8F5C" : "#4A7690" }}>
                  {e.isRefund ? "+" : ""}${formatMoney(e.amount)}
                </div>
                {e.recurring ? (
                  <div style={{ width: 22 }} />
                ) : (
                  <button onClick={() => removeEntry(e.id)} style={{ border: "none", background: "none", color: "#E8BFB8", cursor: "pointer", padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div style={{ textAlign: "center", fontSize: 11, color: "#5F7A8C", marginTop: 14 }}>
          数据仅保存在本设备 · {monthsAvailable.length} 个月记录
        </div>
        </>
        )}

        {activeTab === "trend" && (
        <>
        {/* Monthly spending trend */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: "16px 14px" }}>
          <div style={{ fontSize: 12.5, color: "#2E4356", letterSpacing: 1, fontWeight: 700, marginBottom: 4 }}>
            月度总支出趋势
          </div>
          <div style={{ fontSize: 10.5, color: "#5F7A8C", marginBottom: 12 }}>
            {trendMonths[0]} 至 {trendMonths[trendMonths.length - 1]}，近 6 个月
          </div>

          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#F3CFC7" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickFormatter={m => m.slice(5)}
                  tick={{ fontSize: 11, fill: "#5F7A8C" }}
                  axisLine={{ stroke: "#E8BFB8" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#5F7A8C" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={v => `$${v}`}
                />
                <Tooltip
                  formatter={(v) => [`$${formatMoney(v)}`, "总支出"]}
                  labelFormatter={(m) => m}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#4A7690"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#4A7690" }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Month-by-month breakdown */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", borderRadius: "4px 4px 20px 20px", padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, color: "#2E4356", letterSpacing: 1, fontWeight: 700, marginBottom: 10 }}>
            逐月明细
          </div>
          {monthlyTrend.slice().reverse().map((m, idx) => {
            const prev = monthlyTrend[monthlyTrend.length - 2 - idx];
            const diff = prev ? m.total - prev.total : null;
            const isCurrent = m.month === selectedMonth;
            return (
              <div key={m.month} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
                borderTop: idx === 0 ? "none" : "1px dashed #F3CFC7",
              }}>
                <div style={{
                  fontSize: 13, fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "#4A7690" : "#2E4356",
                  fontFamily: "'JetBrains Mono', monospace", flex: 1,
                }}>
                  {m.month}{isCurrent && " · 本月"}
                </div>
                {diff !== null && diff !== 0 && (
                  <div style={{
                    fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                    color: diff > 0 ? "#C85647" : "#5C8F5C",
                  }}>
                    {diff > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(diff))}
                  </div>
                )}
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, color: "#4A7690", minWidth: 80, textAlign: "right" }}>
                  ${formatMoney(m.total)}
                </div>
              </div>
            );
          })}
        </div>
        </>
        )}

        {activeTab === "assets" && (
        <>
        {/* Net worth summary */}
        <div style={{ background: "#4A7690", color: "#F5DFDA", padding: "18px 20px", borderTop: "none", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -14, right: -6, fontSize: 70, opacity: 0.12, transform: "rotate(15deg)" }}>⚽</div>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.6, marginBottom: 8 }}>
            净资产 <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>NET WORTH</span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 26 }}>
            ${formatMoney(netWorth)}
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 12, fontSize: 12 }}>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 2 }}>总资产</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#A8C9A0" }}>${formatMoney(totalAssets)}</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 2 }}>总负债</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#E89494" }}>${formatMoney(totalLiabilities)}</div>
            </div>
          </div>
        </div>

        {/* Asset breakdown chart */}
        {assetPieData.length > 0 && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: "10px 8px 4px" }}>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={assetPieData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={68} paddingAngle={3}>
                    {assetPieData.map((d, i) => <Cell key={i} fill={d.color} stroke="#FFFFFF" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `$${formatMoney(v)}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", justifyContent: "center", paddingBottom: 10, fontSize: 12 }}>
              {assetPieData.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, color: "#2E4356" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: "inline-block" }} />
                  {d.name} ${formatMoney(d.value)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Assets list + add form */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, color: "#2E4356", letterSpacing: 1, fontWeight: 700, marginBottom: 10 }}>
            资产
          </div>

          {assets.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {assets.map(a => (
                <div key={a.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  border: "1px solid #F3CFC7", borderRadius: 8, marginBottom: 6, background: "#F7E1DB",
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: ASSET_CAT_MAP[a.category].color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: "#5F7A8C" }}>{ASSET_CAT_MAP[a.category].label}</div>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    ${formatMoney(a.value)}
                  </div>
                  <button onClick={() => removeAsset(a.id)} style={{ border: "none", background: "none", color: "#E8BFB8", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {ASSET_CATEGORIES.map(c => (
              <button
                key={c.key}
                onClick={() => setAssetForm({ ...assetForm, category: c.key })}
                style={{
                  padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer",
                  border: `1.5px solid ${assetForm.category === c.key ? c.color : "#E8BFB8"}`,
                  background: assetForm.category === c.key ? c.color : "transparent",
                  color: assetForm.category === c.key ? "#FFFFFF" : "#4A7690",
                  fontWeight: assetForm.category === c.key ? 700 : 400,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="资产名称，如 招商银行储蓄"
              value={assetForm.name}
              onChange={e => setAssetForm({ ...assetForm, name: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 140px", outline: "none" }}
            />
            <input
              type="number"
              placeholder="金额"
              value={assetForm.value}
              onChange={e => setAssetForm({ ...assetForm, value: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 80px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
            <button
              onClick={addAsset}
              style={{
                background: "#5C8F5C", color: "#FFFFFF", border: "none", borderRadius: 8,
                padding: "0 12px", display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0,
                boxShadow: "0 2px 6px rgba(46,125,79,0.4)",
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          {assetError && <div style={{ color: "#C85647", fontSize: 12 }}>{assetError}</div>}
        </div>

        {/* Liabilities list + add form */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", borderRadius: "4px 4px 20px 20px", padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, color: "#2E4356", letterSpacing: 1, fontWeight: 700, marginBottom: 10 }}>
            负债
          </div>

          {liabilities.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {liabilities.map(l => (
                <div key={l.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  border: "1px solid #F3CFC7", borderRadius: 8, marginBottom: 6, background: "#F7E1DB",
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: "#C85647" }} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.name}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, flexShrink: 0, color: "#C85647" }}>
                    ${formatMoney(l.value)}
                  </div>
                  <button onClick={() => removeLiability(l.id)} style={{ border: "none", background: "none", color: "#E8BFB8", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="负债名称，如 房贷"
              value={liabilityForm.name}
              onChange={e => setLiabilityForm({ ...liabilityForm, name: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 140px", outline: "none" }}
            />
            <input
              type="number"
              placeholder="金额"
              value={liabilityForm.value}
              onChange={e => setLiabilityForm({ ...liabilityForm, value: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 80px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
            <button
              onClick={addLiability}
              style={{
                background: "#C85647", color: "#FFFFFF", border: "none", borderRadius: 8,
                padding: "0 12px", display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0,
                boxShadow: "0 2px 6px rgba(200,86,71,0.4)",
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          {liabilityError && <div style={{ color: "#C85647", fontSize: 12 }}>{liabilityError}</div>}

          <div style={{ fontSize: 10.5, color: "#5F7A8C", marginTop: 10, borderTop: "1px dashed #E8BFB8", paddingTop: 10 }}>
            提示：信用卡欠款可以在这里手动记一笔，和"记账"里的还款计划分开管理
          </div>
        </div>
        </>
        )}

        {activeTab === "funds" && (
        <>
        {/* Fund total summary */}
        <div style={{ background: "#4A7690", color: "#F5DFDA", padding: "18px 20px", borderTop: "none", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -14, right: -6, fontSize: 70, opacity: 0.12, transform: "rotate(15deg)" }}>⚽</div>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.6, marginBottom: 8 }}>
            基金总额
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 26 }}>
            ${formatMoney(totalSaved)}
          </div>
        </div>

        <div style={{ background: "#FFFFFF", border: "1px solid #E8BFB8", borderTop: "none", borderRadius: "4px 4px 20px 20px", padding: "16px 18px" }}>
          {savingsGoals.length === 0 && (
            <div style={{ fontSize: 12.5, color: "#5F7A8C", textAlign: "center", padding: "10px 0" }}>
              还没有基金，在下面创建一个吧
            </div>
          )}

          {savingsGoals.map(g => {
            const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
            const log = [...(g.usageLog || [])].sort((a, b) => b.date.localeCompare(a.date));
            return (
              <div key={g.id} style={{
                border: "1px solid #F3CFC7", borderRadius: 8, padding: "12px 14px", marginBottom: 12, background: "#F7E1DB",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 80px", minWidth: 0, fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {g.name}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#2E4356" }}>
                    ${formatMoney(g.saved)} / ${formatMoney(g.target)}
                  </div>
                  <button onClick={() => removeGoal(g.id)} style={{ border: "none", background: "none", color: "#E8BFB8", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: "#F3CFC7", overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "#5C8F5C", borderRadius: 4, transition: "width 0.3s" }} />
                </div>

                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input
                    type="number"
                    placeholder="存入金额"
                    value={contribInput[g.id] ?? ""}
                    onChange={e => setContribInput(prev => ({ ...prev, [g.id]: e.target.value }))}
                    style={{ border: "1px solid #E8BFB8", borderRadius: 6, padding: "5px 8px", fontSize: 12, flex: 1, fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
                  />
                  <button
                    onClick={() => addContribution(g.id)}
                    style={{ background: "#5C8F5C", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "0 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
                  >
                    存入
                  </button>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="number"
                    placeholder="使用金额"
                    value={usageInput[g.id] ?? ""}
                    onChange={e => setUsageInput(prev => ({ ...prev, [g.id]: e.target.value }))}
                    style={{ border: "1px solid #E8BFB8", borderRadius: 6, padding: "5px 8px", fontSize: 12, flex: 1, fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
                  />
                  <button
                    onClick={() => useFund(g.id)}
                    style={{ background: "#E89494", color: "#FFFFFF", border: "none", borderRadius: 6, padding: "0 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
                  >
                    使用
                  </button>
                </div>
                {usageError[g.id] && <div style={{ color: "#C85647", fontSize: 11, marginTop: 5 }}>{usageError[g.id]}</div>}
                <div style={{ fontSize: 10.5, color: "#5F7A8C", marginTop: 4 }}>
                  使用后会自动作为转入记录同步到"记账"的转账与现金流里
                </div>

                {log.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: "1px dashed #E8BFB8", paddingTop: 8 }}>
                    <div style={{ fontSize: 10.5, color: "#5F7A8C", marginBottom: 4 }}>使用记录</div>
                    {log.slice(0, 5).map(u => (
                      <div key={u.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#2E4356", padding: "2px 0" }}>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{u.date}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#E89494", fontWeight: 600 }}>-${formatMoney(u.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, borderTop: savingsGoals.length > 0 ? "1px dashed #E8BFB8" : "none", paddingTop: savingsGoals.length > 0 ? 14 : 0 }}>
            <input
              type="text"
              placeholder="基金名称，如 应急基金"
              value={goalForm.name}
              onChange={e => setGoalForm({ ...goalForm, name: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 130px", outline: "none" }}
            />
            <input
              type="number"
              placeholder="目标金额"
              value={goalForm.target}
              onChange={e => setGoalForm({ ...goalForm, target: e.target.value })}
              style={{ border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, flex: "1 1 80px", fontFamily: "'JetBrains Mono', monospace", outline: "none" }}
            />
            <button
              onClick={addGoal}
              style={{
                background: "#5C8F5C", color: "#FFFFFF", border: "none", borderRadius: 8,
                padding: "0 12px", display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0,
                boxShadow: "0 2px 6px rgba(46,125,79,0.4)",
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          {goalError && <div style={{ color: "#C85647", fontSize: 12 }}>{goalError}</div>}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

function SummaryCell({ icon, label, value, tone }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#2E4356", marginBottom: 3 }}>
        {icon} {label}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 18, color: tone }}>
        ${formatMoney(value)}
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder, prefix, suffix }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#5F7A8C", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", border: "1px solid #E8BFB8", borderRadius: 8, padding: "7px 10px" }}>
        {prefix && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#2E4356", marginRight: 3 }}>{prefix}</span>}
        <input
          type="number"
          placeholder={placeholder}
          value={value ?? ""}
          onChange={e => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
          style={{ border: "none", outline: "none", width: "100%", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, background: "transparent" }}
        />
        {suffix && <span style={{ fontSize: 12, color: "#2E4356", marginLeft: 3 }}>{suffix}</span>}
      </div>
    </div>
  );
}

const navBtnStyle = {
  background: "rgba(245,223,218,0.12)", border: "none", color: "#F5DFDA",
  width: 26, height: 26, borderRadius: 6, cursor: "pointer", fontSize: 16, lineHeight: 1,
};
