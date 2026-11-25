import { QRCodeSVG } from "qrcode.react";
import { usePreferences } from "../contexts/preferencesState";

export type StudentCardData = {
  id: string;
  full_name: string;
  student_code: string;
  grade_level?: string | null;
  group_name?: string | null;
  group_id?: string | null;
  qr_code_hash: string;
  status?: string;
};

type Props = {
  student: StudentCardData;
  centerName?: string;
};

export default function StudentIdCard({
  student,
  centerName = "EduTrack Center",
}: Props) {
  const { language } = usePreferences();

  return (
    <div
      dir="ltr"
      className="relative flex h-[54mm] w-[85.6mm] overflow-hidden rounded-[3mm] border border-slate-300 bg-white font-sans shadow-sm"
      style={{
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {/* Side strip */}
      <div className="flex w-[8mm] items-center justify-center bg-[#174E50]">
        <span
          className="whitespace-nowrap text-[7pt] font-bold tracking-wide text-white"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          STUDENT ID
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col justify-between p-[3mm]">
        <div className="flex items-center justify-between">
          <h3 className="text-[9pt] font-extrabold text-[#174E50]">
            {centerName}
          </h3>
          <span className="rounded bg-[#D8E8DC] px-[2mm] py-[0.5mm] text-[6pt] font-semibold uppercase text-[#174E50]">
            {language === "ar" ? "كارت طالب" : "Student Card"}
          </span>
        </div>

        <div className="flex items-center gap-[3mm]">
          {/* QR code (SVG, stays sharp when printed, marginSize={2} gives proper quiet zone) */}
          <div className="rounded-[2mm] border border-slate-200 bg-white p-[1mm]">
            <QRCodeSVG
              value={student.qr_code_hash}
              size={88}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#0f172a"
            />
          </div>

          {/* Student info */}
          <div className="flex-1 space-y-[1mm]">
            <p
              dir="auto"
              className="text-[10pt] font-bold leading-tight text-slate-900"
            >
              {student.full_name}
            </p>
            <p dir="auto" className="text-[7pt] text-slate-600">
              {language === "ar" ? "الكود:" : "Code:"}{" "}
              <span className="font-mono font-bold text-slate-800">{student.student_code}</span>
            </p>
            {student.grade_level && (
              <p dir="auto" className="text-[7pt] text-slate-600">
                {language === "ar" ? "الصف:" : "Grade:"} {student.grade_level}
              </p>
            )}
            {student.group_name && (
              <p dir="auto" className="text-[7pt] text-slate-600">
                {language === "ar" ? "المجموعة:" : "Group:"} {student.group_name}
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-[5.5pt] text-slate-400">
          ID: {student.student_code || student.id.slice(0, 8).toUpperCase()} •{" "}
          {language === "ar" ? "امسح الكارت عند دخول القاعة" : "Show this card at the entrance"}
        </p>
      </div>
    </div>
  );
}
