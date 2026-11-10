import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import StudentIdCard, { StudentCardData } from "./StudentIdCard";

const DEFAULT_STUDENTS: StudentCardData[] = [
  { id: "1", full_name: "Lara Hassan", grade: "Grade 8", class_name: "Grade 8A", qr_token: "ET-LARA-2048" },
  { id: "2", full_name: "Adam Nabil", grade: "Grade 7", class_name: "Grade 7B", qr_token: "ET-ADAM-2049" },
  { id: "3", full_name: "Youssef Ali", grade: "Grade 9", class_name: "Grade 9C", qr_token: "ET-YOUSSEF-2050" },
  { id: "4", full_name: "Mariam Samir", grade: "Grade 8", class_name: "Grade 8A", qr_token: "ET-MARIAM-2051" },
];

export default function StudentCardsPrintPage() {
  const [students, setStudents] = useState<StudentCardData[]>(DEFAULT_STUDENTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("students")
          .select("id, full_name, grade, class_name, photo_url, qr_token")
          .order("full_name");

        if (error || !data || data.length === 0) {
          setStudents(DEFAULT_STUDENTS);
        } else {
          setStudents(data);
        }
      } catch {
        setStudents(DEFAULT_STUDENTS);
      } finally {
        setLoading(false);
      }
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
          Print Student Cards (Abdelrahman Khodary)
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
          🖨️ Print Cards
        </button>
      </div>

      {loading && <p className="text-slate-500">Loading...</p>}
      {error && <p className="text-red-600">Error: {error}</p>}

      {/* Cards grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-4">
        {filtered.map((s) => (
          <StudentIdCard key={s.id} student={s} centerName="EduTrack Center" />
        ))}
      </div>
    </div>
  );
}
