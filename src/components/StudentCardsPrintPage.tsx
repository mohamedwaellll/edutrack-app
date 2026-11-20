import React, { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import StudentIdCard, { StudentCardData } from "./StudentIdCard";
import { ArrowLeft, Printer, Search, RefreshCw, AlertCircle, Users } from "lucide-react";

interface GroupOption {
  id: string;
  name: string;
  grade_level?: string;
}

interface StudentCardsPrintPageProps {
  onBack?: () => void;
}

export default function StudentCardsPrintPage({ onBack }: StudentCardsPrintPageProps) {
  const [students, setStudents] = useState<StudentCardData[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchData = async () => {
    if (!isSupabaseConfigured()) {
      setError("Supabase credentials are not configured in .env");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Fetch class groups for the filter dropdown
      const { data: groupsData, error: groupsErr } = await supabase
        .from("groups")
        .select("id, name, grade_level")
        .order("name");

      if (groupsErr) {
        throw new Error(`Failed to load groups: ${groupsErr.message}`);
      }
      setGroups(groupsData || []);

      // 2. Fetch real students with joined group name
      const { data: studentsData, error: studentsErr } = await supabase
        .from("students")
        .select("id, full_name, student_code, group_id, grade_level, qr_code_hash, status, groups(name)")
        .order("full_name");

      if (studentsErr) {
        throw new Error(`Failed to load students: ${studentsErr.message}`);
      }

      const mapped: StudentCardData[] = (studentsData || []).map((s: any) => ({
        id: s.id,
        full_name: s.full_name,
        student_code: s.student_code,
        group_id: s.group_id,
        grade_level: s.grade_level,
        group_name: s.groups?.name || "Unassigned",
        qr_code_hash: s.qr_code_hash || `ET-${s.student_code}`,
        status: s.status,
      }));

      setStudents(mapped);
    } catch (err: any) {
      setError(err.message || "Failed to load student card data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      const matchesSearch =
        !q ||
        s.full_name.toLowerCase().includes(q) ||
        (s.student_code && s.student_code.toLowerCase().includes(q));

      const matchesGroup =
        selectedGroupId === "all" || s.group_id === selectedGroupId;

      return matchesSearch && matchesGroup;
    });
  }, [students, query, selectedGroupId]);

  return (
    <div
      dir="ltr"
      className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0 font-sans"
    >
      {/* Top Navigation & Toolbar (hidden during print) */}
      <div className="mb-6 space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </button>
            )}
            <div>
              <h1 className="text-xl font-black text-slate-800">
                Student ID Cards & QR Codes
              </h1>
              <p className="text-xs text-slate-500">
                Print sharp physical badges with real QR hashes for entry scanner
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={() => window.print()}
              disabled={filtered.length === 0}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              <Printer className="w-4 h-4" />
              Print Cards ({filtered.length})
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by student name or code..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Group Dropdown */}
          <div className="min-w-[200px]">
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-800 bg-white focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Class Groups ({students.length})</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.grade_level ? `(${g.grade_level})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs font-semibold text-slate-500 px-2">
            Showing <span className="text-slate-900 font-bold">{filtered.length}</span> of {students.length} student{students.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchData}
            className="underline font-bold text-rose-900 hover:text-rose-950"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center p-12 text-slate-500 text-xs gap-2 print:hidden">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
          <span>Loading real student records from database...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-3xl border border-slate-200 text-center print:hidden">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 mb-3">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 mb-1">No Student Cards Found</h3>
          <p className="text-xs text-slate-500 max-w-sm">
            {query || selectedGroupId !== "all"
              ? "No students match your filter criteria. Try clearing search or selecting all groups."
              : "No students have been added to the database yet. Add students via Admin Dashboard to generate their QR cards."}
          </p>
        </div>
      )}

      {/* Cards Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-4">
          {filtered.map((s) => (
            <StudentIdCard key={s.id} student={s} centerName="EduTrack Center" />
          ))}
        </div>
      )}
    </div>
  );
}
