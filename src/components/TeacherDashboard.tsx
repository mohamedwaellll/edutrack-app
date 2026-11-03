import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  BookOpen, 
  Award, 
  FileText, 
  Users, 
  Plus, 
  Search, 
  Save, 
  Eye, 
  CheckCircle, 
  ArrowLeft,
  ChevronRight,
  TrendingUp,
  MessageSquare
} from 'lucide-react';
import { teacherService } from '../services/teacherService';
import { adminService } from '../services/adminService';
import { GradeRecord, TeacherFeedback, GroupClass, Student } from '../types/database';

interface TeacherDashboardProps {
  onSwitchToAdmin?: () => void;
  teacherName?: string;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  onSwitchToAdmin,
  teacherName = "Dr. Salma Farid"
}) => {
  const [selectedClass, setSelectedClass] = useState<string>('Grade 8A');
  const [classes, setClasses] = useState<GroupClass[]>([]);
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [feedbacks, setFeedbacks] = useState<TeacherFeedback[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);

  // New Grade Modal
  const [showAddGradeModal, setShowAddGradeModal] = useState(false);
  const [targetStudentId, setTargetStudentId] = useState('');
  const [assessmentTitle, setAssessmentTitle] = useState('');
  const [score, setScore] = useState<number>(95);
  const [maxScore, setMaxScore] = useState<number>(100);
  const [gradeType, setGradeType] = useState<'exam' | 'quiz' | 'assignment'>('exam');
  const [gradeNote, setGradeNote] = useState('');

  // New Feedback Modal
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackStudentId, setFeedbackStudentId] = useState('');
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isParentVisible, setIsParentVisible] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cls, grds, fbs, stds] = await Promise.all([
        adminService.getClasses(),
        teacherService.getGrades(),
        teacherService.getFeedback(),
        adminService.getStudents(),
      ]);
      setClasses(cls);
      setGrades(grds);
      setFeedbacks(fbs);
      setStudents(stds);
      if (stds.length > 0) {
        setTargetStudentId(stds[0].id);
        setFeedbackStudentId(stds[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    const st = students.find(s => s.id === targetStudentId) || students[0];
    const newRecord: Omit<GradeRecord, 'id'> = {
      student_id: st?.id || 's-1',
      student_name: st?.full_name || 'Lara Hassan',
      class_id: 'cls-1',
      class_name: selectedClass,
      subject: 'Science',
      assessment_title: assessmentTitle,
      score,
      max_score: maxScore,
      date: new Date().toISOString().slice(0, 10),
      type: gradeType,
      notes: gradeNote,
    };

    await teacherService.addGrade(newRecord);
    setGrades(prev => [{ id: `g-${Date.now()}`, ...newRecord }, ...prev]);
    setShowAddGradeModal(false);
    setAssessmentTitle('');
    setGradeNote('');
  };

  const handleSaveFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    const st = students.find(s => s.id === feedbackStudentId) || students[0];
    const newFb: Omit<TeacherFeedback, 'id'> = {
      teacher_id: 't-1',
      teacher_name: teacherName,
      student_id: st?.id || 's-1',
      student_name: st?.full_name || 'Lara Hassan',
      feedback_text: feedbackContent,
      is_parent_visible: isParentVisible,
      date: new Date().toISOString().slice(0, 10),
    };

    await teacherService.addFeedback(newFb);
    setFeedbacks(prev => [{ id: `fb-${Date.now()}`, ...newFb }, ...prev]);
    setShowFeedbackModal(false);
    setFeedbackContent('');
  };

  const filteredGrades = grades.filter(g => !selectedClass || g.class_name === selectedClass);

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-[#26334A] flex font-sans selection:bg-[#D8E8DC]">
      {/* SIDEBAR */}
      <aside className="w-64 border-r border-[#E6E8E2] bg-[#F8F7F2] p-6 flex flex-col justify-between hidden md:flex shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-10 text-[#174E50]">
            <Sparkles className="w-5 h-5 fill-current text-[#174E50]" />
            <span className="text-xl font-bold tracking-tight text-[#17213B]">EduTrack</span>
          </div>

          <div className="space-y-4">
            <span className="text-[11px] font-bold text-[#7B8794] uppercase tracking-wider">Your Active Classes</span>
            <div className="space-y-1.5">
              {['Grade 8A', 'Grade 7B', 'Grade 9C'].map((clsName) => {
                const isSelected = selectedClass === clsName;
                return (
                  <button
                    key={clsName}
                    onClick={() => setSelectedClass(clsName)}
                    className={`w-full text-left px-4 py-2.5 rounded-full text-xs font-semibold transition ${
                      isSelected 
                        ? 'bg-[#174E50] text-white shadow-xs' 
                        : 'text-[#7B8794] hover:bg-white/80'
                    }`}
                  >
                    {clsName}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {onSwitchToAdmin && (
          <button
            onClick={onSwitchToAdmin}
            className="w-full flex items-center justify-between p-3 rounded-2xl bg-white border border-[#E6E8E2] text-xs font-semibold text-[#174E50] hover:bg-[#D8E8DC]/40 transition"
          >
            <div className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Admin Panel</span>
            </div>
          </button>
        )}
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-6 md:p-10 max-w-7xl mx-auto overflow-y-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-[#17213B] tracking-tight">Teacher & Grades Hub</h1>
            <p className="text-[#7B8794] text-sm mt-1">Week 2: Grade books, student remarks, and parent sync</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddGradeModal(true)}
              className="px-4 py-2.5 rounded-full bg-[#174E50] text-white text-xs font-semibold hover:bg-[#174E50]/90 transition flex items-center gap-1.5 shadow-xs"
            >
              <Plus className="w-4 h-4" /> Record Grade
            </button>
            <button
              onClick={() => setShowFeedbackModal(true)}
              className="px-4 py-2.5 rounded-full bg-white border border-[#E6E8E2] text-[#174E50] text-xs font-semibold hover:bg-[#D8E8DC]/40 transition flex items-center gap-1.5 shadow-xs"
            >
              <MessageSquare className="w-4 h-4" /> Add Feedback
            </button>
          </div>
        </header>

        {/* Top 3 Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
            <span className="text-xs font-semibold text-[#7B8794]">Class In Focus</span>
            <div className="text-2xl font-extrabold text-[#17213B] mt-1">{selectedClass}</div>
            <p className="text-xs text-[#174E50] font-semibold mt-1">Science • Room 204</p>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
            <span className="text-xs font-semibold text-[#7B8794]">Class Average</span>
            <div className="text-2xl font-extrabold text-[#17213B] mt-1">91.4%</div>
            <p className="text-xs text-emerald-600 font-semibold mt-1">+3.2% this term</p>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
            <span className="text-xs font-semibold text-[#7B8794]">Submitted Evaluations</span>
            <div className="text-2xl font-extrabold text-[#17213B] mt-1">{filteredGrades.length}</div>
            <p className="text-xs text-[#7B8794] mt-1">All synced with Supabase</p>
          </div>
        </div>

        {/* Section: Grades Book */}
        <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-[#174E50]" />
              <h3 className="text-lg font-bold text-[#17213B]">Grades Ledger ({selectedClass})</h3>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#D8E8DC]/30 text-[#7B8794] font-semibold uppercase tracking-wider rounded-xl">
                  <th className="py-3 px-4 rounded-l-xl">STUDENT</th>
                  <th className="py-3 px-4">ASSESSMENT</th>
                  <th className="py-3 px-4">TYPE</th>
                  <th className="py-3 px-4">SCORE</th>
                  <th className="py-3 px-4">PERCENTAGE</th>
                  <th className="py-3 px-4 rounded-r-xl">TEACHER REMARKS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8E2]/70">
                {filteredGrades.map((g) => {
                  const pct = Math.round((g.score / g.max_score) * 100);
                  return (
                    <tr key={g.id} className="hover:bg-[#F8F7F2]/60">
                      <td className="py-3.5 px-4 font-bold text-[#17213B]">{g.student_name}</td>
                      <td className="py-3.5 px-4 text-[#7B8794]">{g.assessment_title}</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#F8F7F2] border border-[#E6E8E2]">
                          {g.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-[#17213B]">
                        {g.score} / {g.max_score}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          pct >= 90 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {pct}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[#7B8794] max-w-xs truncate">{g.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section: Teacher Remarks / Feedback (Feed for Parent Portal) */}
        <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-[#553B8F]" />
              <h3 className="text-lg font-bold text-[#17213B]">Teacher Feedback Log (Synced with Parent Portal)</h3>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {feedbacks.map((fb) => (
              <div key={fb.id} className="p-5 rounded-2xl border border-[#E6E8E2] bg-[#F8F7F2]/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#17213B]">{fb.student_name}</span>
                  <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                    Visible to Parent
                  </span>
                </div>
                <p className="text-xs text-[#26334A] leading-relaxed italic">
                  "{fb.feedback_text}"
                </p>
                <div className="pt-2 border-t border-[#E6E8E2] flex items-center justify-between text-[11px] text-[#7B8794]">
                  <span>By: {fb.teacher_name}</span>
                  <span>{fb.date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* MODAL: ADD GRADE */}
      {showAddGradeModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-xl border border-[#E6E8E2]">
            <h3 className="text-lg font-bold text-[#17213B] mb-3">Record Student Grade</h3>
            <form onSubmit={handleSaveGrade} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Select Student</label>
                <select
                  value={targetStudentId}
                  onChange={(e) => setTargetStudentId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                >
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name} ({s.class_name})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Assessment Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Science Chapter 04 Quiz"
                  value={assessmentTitle}
                  onChange={(e) => setAssessmentTitle(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#7B8794] mb-1 font-semibold">Score</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                  />
                </div>
                <div>
                  <label className="block text-[#7B8794] mb-1 font-semibold">Max Score</label>
                  <input
                    type="number"
                    step="1"
                    required
                    value={maxScore}
                    onChange={(e) => setMaxScore(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Assessment Category</label>
                <select
                  value={gradeType}
                  onChange={(e) => setGradeType(e.target.value as any)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                >
                  <option value="exam">Exam</option>
                  <option value="quiz">Quiz</option>
                  <option value="assignment">Assignment</option>
                </select>
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Teacher Remarks</label>
                <textarea
                  rows={2}
                  placeholder="Feedback on strengths or points of improvement..."
                  value={gradeNote}
                  onChange={(e) => setGradeNote(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddGradeModal(false)}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90"
                >
                  Save Grade
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD FEEDBACK */}
      {showFeedbackModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-xl border border-[#E6E8E2]">
            <h3 className="text-lg font-bold text-[#17213B] mb-3">Add Feedback for Parent</h3>
            <form onSubmit={handleSaveFeedback} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Select Student</label>
                <select
                  value={feedbackStudentId}
                  onChange={(e) => setFeedbackStudentId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                >
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name} ({s.class_name})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#7B8794] mb-1 font-semibold">Feedback Text</label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Student shows great enthusiasm in class discussions..."
                  value={feedbackContent}
                  onChange={(e) => setFeedbackContent(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-[#E6E8E2] focus:outline-none focus:border-[#174E50]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="parentVis"
                  checked={isParentVisible}
                  onChange={(e) => setIsParentVisible(e.target.checked)}
                  className="rounded text-[#174E50] focus:ring-0"
                />
                <label htmlFor="parentVis" className="text-[#26334A] font-medium">
                  Make visible in Parent Portal (Youssef El-Qadi)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowFeedbackModal(false)}
                  className="px-4 py-2 rounded-full border border-[#E6E8E2] text-[#7B8794] font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-[#174E50] text-white font-semibold hover:bg-[#174E50]/90"
                >
                  Publish Feedback
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default TeacherDashboard;
