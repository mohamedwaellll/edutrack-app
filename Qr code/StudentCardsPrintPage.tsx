import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase"; // adjust the path to match Ali's project structure
import StudentIdCard, { StudentCardData } from "./StudentIdCard";

export default function StudentCardsPrintPage() {
  const [students, setStudents] = useState<StudentCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, grade, class_name, photo_url, qr_token")
        .order("full_name");

      if (error) setError(error.message);
      else setStudents(data ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(
    () =>
      students.filter((s) =>
        s.full_name.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [students, query]
  );

  return (
    <div
      dir="ltr"
      className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0"
    >
      {/* Toolbar (hidden when printing) */}
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="text-xl font-bold text-slate-800">
          Print Student Cards
        </h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by student name..."
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="text-sm text-slate-500">
          {filtered.length} card{filtered.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => window.print()}
          className="ml-auto rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          🖨️ Print
        </button>
      </div>

      {loading && <p className="text-slate-500">Loading...</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-slate-500">No students found.</p>
      )}

      {/* A4: 3 columns x 5 rows = 15 cards per page */}
      <div className="mx-auto grid w-fit grid-cols-3 gap-[4mm] print:gap-[3mm]">
        {filtered.map((s) => (
          <div key={s.id} className="break-inside-avoid">
            <StudentIdCard student={s} />
          </div>
        ))}
      </div>

      {/* Print settings */}
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
