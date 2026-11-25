import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import StudentIdCard, { StudentCardData } from "./StudentIdCard";
import { usePreferences } from "../contexts/preferencesState";
import { DisplayControls } from "./DisplayControls";
import { ArrowLeft, Printer, Search, RefreshCw, AlertCircle, Users } from "lucide-react";

interface GroupOption {
  id: string;
  name: string;
  grade_level?: string;
}

interface RawStudentCardRow {
  id: string;
  full_name: string;
  student_code: string;
  group_id: string | null;
  grade_level?: string;
  qr_code_hash?: string | null;
  status?: string;
  groups?: { name?: string | null } | null;
}

interface StudentCardsPrintPageProps {
  onBack?: () => void;
}

export default function StudentCardsPrintPage({ onBack }: StudentCardsPrintPageProps) {
  const { language, isRtl, t } = usePreferences();
  const configured = isSupabaseConfigured();
  const [students, setStudents] = useState<StudentCardData[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("all");
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(
    configured ? null : "Supabase credentials are not configured in .env"
  );
  const [query, setQuery] = useState("");
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const fetchGroupsAndStudents = useCallback(async () => {
    const [groupsResult, studentsResult] = await Promise.all([
      supabase.from("groups").select("id, name, grade_level").order("name"),
      supabase
        .from("students")
        .select("id, full_name, student_code, group_id, grade_level, qr_code_hash, status, groups(name)")
        .order("full_name"),
    ]);

    if (groupsResult.error) {
      throw new Error(`Failed to load groups: ${groupsResult.error.message}`);
    }
    if (studentsResult.error) {
      throw new Error(`Failed to load students: ${studentsResult.error.message}`);
    }

    const mapped: StudentCardData[] = ((studentsResult.data || []) as RawStudentCardRow[]).map((s) => ({
      id: s.id,
      full_name: s.full_name,
      student_code: s.student_code,
      group_id: s.group_id,
      grade_level: s.grade_level,
      group_name: s.groups?.name || "Unassigned",
      qr_code_hash: s.qr_code_hash || `ET-${s.student_code}`,
      status: s.status,
    }));

    return {
      groups: groupsResult.data || [],
      students: mapped,
    };
  }, []);

  const fetchData = async () => {
    if (!isSupabaseConfigured()) {
      setError("Supabase credentials are not configured in .env");
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchGroupsAndStudents();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setGroups(data.groups);
      setStudents(data.students);
      setError(null);
    } catch (err: unknown) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load student card data");
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }
    mountedRef.current = true;
    const reqRef = requestIdRef;
    const requestId = ++reqRef.current;

    fetchGroupsAndStudents()
      .then((data) => {
        if (!mountedRef.current || requestId !== reqRef.current) return;
        setGroups(data.groups);
        setStudents(data.students);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || requestId !== reqRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load student card data");
      })
      .finally(() => {
        if (mountedRef.current && requestId === reqRef.current) {
          setLoading(false);
        }
      });

    return () => {
      mountedRef.current = false;
      reqRef.current++;
    };
  }, [fetchGroupsAndStudents]);

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
      dir={isRtl ? "rtl" : "ltr"}
      className="min-h-screen bg-[#F8F7F2] dark:bg-[#0B121B] p-6 print:bg-white print:p-0 font-sans text-[#26334A] dark:text-slate-100"
    >
      {/* Top Navigation & Toolbar (hidden during print) */}
      <div className="mb-6 space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 text-xs font-bold text-[#26334A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                {t("backToDashboardBtn")}
              </button>
            )}
            <div>
              <h1 className="text-xl font-extrabold text-[#17213B] dark:text-white">
                {t("studentCardsPageTitle")}
              </h1>
              <p className="text-xs text-[#64748B] dark:text-slate-400">
                {t("studentCardsPageSubtitle")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DisplayControls variant="compact" />
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-700 text-xs font-semibold text-[#26334A] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              {t("refresh")}
            </button>
            <button
              onClick={() => window.print()}
              disabled={filtered.length === 0}
              className="flex items-center gap-2 rounded-xl bg-[#174E50] hover:bg-[#123E40] dark:bg-[#147477] dark:hover:bg-[#106063] px-5 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-50 transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              {t("printCardsBtn", { count: filtered.length })}
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white dark:bg-[#131E2B] p-4 rounded-2xl border border-[#E6E8E2] dark:border-slate-800 shadow-xs flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-[#7B8794] dark:text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchCardsPlaceholder")}
              className="w-full ps-9 pe-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-xs font-medium text-[#17213B] dark:text-white placeholder-[#9AA39C] dark:placeholder-slate-500 focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
            />
          </div>

          {/* Group Dropdown */}
          <div className="min-w-[200px]">
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-xs font-medium text-[#17213B] dark:text-white bg-white dark:bg-[#0D1520] focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
            >
              <option value="all">{t("allClassGroupsOption", { count: students.length })}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.grade_level ? `(${g.grade_level})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs font-semibold text-[#64748B] dark:text-slate-400 px-2">
            {t("showingCardsCount", {
              shown: filtered.length,
              total: students.length,
              plural: students.length === 1 ? "" : "s",
            })}
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchData}
            className="underline font-bold text-rose-900 dark:text-rose-100 hover:opacity-80 cursor-pointer"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center p-12 text-[#64748B] dark:text-slate-400 text-xs gap-2 print:hidden">
          <RefreshCw className="w-6 h-6 animate-spin text-[#174E50] dark:text-teal-400" />
          <span>{t("loadingCardsDb")}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-[#131E2B] rounded-3xl border border-[#E6E8E2] dark:border-slate-800 text-center print:hidden">
          <div className="w-12 h-12 rounded-2xl bg-[#F8F7F2] dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 flex items-center justify-center text-[#7B8794] dark:text-slate-400 mb-3">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#17213B] dark:text-white mb-1">
            {t("noCardsFoundTitle")}
          </h3>
          <p className="text-xs text-[#64748B] dark:text-slate-400 max-w-sm">
            {query || selectedGroupId !== "all" ? t("noCardsMatchFilter") : t("noCardsEmptyDb")}
          </p>
        </div>
      )}

      {/* Cards Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-4">
          {filtered.map((s) => (
            <StudentIdCard
              key={s.id}
              student={s}
              centerName={language === "ar" ? "سنتر إيديوتراك" : "EduTrack Center"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
