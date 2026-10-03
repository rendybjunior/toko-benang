// Papan skor bersama: GET = 10 skor tertinggi, POST = kirim skor baru.
// Disimpan di Netlify Blobs. Tiap skor = satu entri sendiri, jadi dua pemain yang kirim
// bersamaan tidak saling menimpa. Urutan abjad nama entri sudah = urutan skor tertinggi.
import { getStore } from "@netlify/blobs";

const MAX_SCORE = 30000;     // batas wajar skor satu game (menolak input aneh)
const MAX_ENTRIES = 300;     // simpan maksimal sekian skor, sisanya (terendah) dibuang
const TOP_N = 10;

// id entri: <9999999 - skor>-<waktu>-<nama dalam hex>
const toHex = s => Buffer.from(s, "utf8").toString("hex");
const fromHex = h => Buffer.from(h, "hex").toString("utf8");
const makeId = (name, score, at) => `${String(9999999 - score).padStart(7, "0")}-${at}-${toHex(name)}`;
function parseId(id) {
  const [inv, at, hex] = id.split("-");
  return { id, name: fromHex(hex), score: 9999999 - Number(inv), at: Number(at) };
}

async function allEntries(store) {
  const { blobs } = await store.list();
  return blobs.map(b => b.key).sort().map(parseId);
}

const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export default async (req) => {
  // "strong": skor yang baru dikirim langsung terbaca (default Netlify Blobs baru terlihat setelah beberapa detik)
  const store = getStore({ name: "leaderboard", consistency: "strong" });

  if (req.method === "GET") {
    const entries = await allEntries(store);
    return json({ top: entries.slice(0, TOP_N) });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Data tidak valid." }, 400); }
    const name = String(body.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
    const score = Number(body.score);
    if (!name) return json({ error: "Nama belum diisi." }, 400);
    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return json({ error: "Skor tidak valid." }, 400);

    const at = Date.now();
    const id = makeId(name, score, at);
    // dryRun: cek alur tanpa benar-benar menyimpan (untuk pengujian)
    if (!body.dryRun) await store.setJSON(id, { name, score, at });

    let entries = await allEntries(store);
    // pastikan skor yang barusan dikirim ikut dihitung walau daftar belum ter-update
    if (!entries.some(e => e.id === id)) entries = [...entries, parseId(id)].sort((a, b) => a.id.localeCompare(b.id));
    const rank = entries.findIndex(e => e.id === id) + 1;   // dihitung sebelum skor terendah dibuang
    if (!body.dryRun && entries.length > MAX_ENTRIES) {
      await Promise.all(entries.slice(MAX_ENTRIES).map(e => store.delete(e.id)));
      entries = entries.slice(0, MAX_ENTRIES);
    }
    return json({ id, rank, top: entries.slice(0, TOP_N) });
  }

  return json({ error: "Metode tidak didukung." }, 405);
};

export const config = { path: "/api/leaderboard" };
