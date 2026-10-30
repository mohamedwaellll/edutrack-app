import { QRCodeSVG } from "qrcode.react";

export type StudentCardData = {
  id: string;
  full_name: string;
  grade?: string | null;
  class_name?: string | null;
  photo_url?: string | null;
  qr_token: string;
};

type Props = {
  student: StudentCardData;
  centerName?: string;
};

export default function StudentIdCard({
  student,
  centerName = "Center Name",
}: Props) {
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
      <div className="flex w-[8mm] items-center justify-center bg-indigo-600">
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
          <h3 className="text-[9pt] font-extrabold text-indigo-700">
            {centerName}
          </h3>
          <span className="rounded bg-indigo-50 px-[2mm] py-[0.5mm] text-[6pt] font-semibold uppercase text-indigo-700">
            Student Card
          </span>
        </div>

        <div className="flex items-center gap-[3mm]">
          {/* QR code (SVG, stays sharp when printed) */}
          <div className="rounded-[2mm] border border-slate-200 bg-white p-[1.5mm]">
            <QRCodeSVG
              value={student.qr_token}
              size={92}
              level="M"
              marginSize={0}
              bgColor="#ffffff"
              fgColor="#0f172a"
            />
          </div>

          {/* Student info */}
          <div className="flex-1 space-y-[1mm]">
            {student.photo_url && (
              <img
                src={student.photo_url}
                alt=""
                className="mb-[1mm] h-[14mm] w-[14mm] rounded-full border border-slate-200 object-cover"
              />
            )}
            <p
              dir="auto"
              className="text-[10pt] font-bold leading-tight text-slate-900"
            >
              {student.full_name}
            </p>
            {student.grade && (
              <p dir="auto" className="text-[7pt] text-slate-600">
                Grade: {student.grade}
              </p>
            )}
            {student.class_name && (
              <p dir="auto" className="text-[7pt] text-slate-600">
                Group: {student.class_name}
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-[5.5pt] text-slate-400">
          ID: {student.id.slice(0, 8).toUpperCase()} • Show this card at the
          entrance
        </p>
      </div>
    </div>
  );
}
