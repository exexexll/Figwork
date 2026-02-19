import PDFDocument from 'pdfkit';
import type { Readable } from 'stream';

interface TranscriptMessage {
  role: string;
  content: string;
  messageType: string;
  question?: {
    questionText: string;
    orderIndex: number;
  } | null;
}

interface InterviewSummary {
  strengths: string[] | null;
  gaps: string[] | null;
  rubricCoverage: Record<string, unknown> | null;
  supportingQuotes: string[] | null;
  rawSummary: string | null;
}

interface CandidateFile {
  filename: string;
  fileType: string;
}

interface PDFData {
  sessionId: string;
  templateName: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  messages: TranscriptMessage[];
  summary: InterviewSummary | null;
  candidateFiles: CandidateFile[];
}

// Colors
const COLORS = {
  primary: '#a78bfa',
  primaryDark: '#7c3aed',
  text: '#1f1f2e',
  textSecondary: '#6b6b80',
  textMuted: '#a0a0b0',
  border: '#e8e4f0',
  aiBackground: '#faf8fc',
};

export function generateInterviewPDF(data: PDFData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc
        .fillColor(COLORS.primaryDark)
        .fontSize(28)
        .font('Helvetica-Bold')
        .text('Interview Transcript', { align: 'center' });

      doc.moveDown(0.5);

      // Metadata bar
      doc
        .fillColor(COLORS.textSecondary)
        .fontSize(10)
        .font('Helvetica')
        .text(`Template: ${data.templateName}`, { continued: true })
        .text(`  |  Status: ${data.status}`, { continued: true });

      if (data.startedAt) {
        doc.text(`  |  Date: ${data.startedAt.toLocaleDateString()}`, { continued: false });
      } else {
        doc.text('', { continued: false });
      }

      doc.moveDown(0.5);

      // Divider
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc
        .strokeColor(COLORS.primary)
        .lineWidth(2)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.margins.left + pageWidth, doc.y)
        .stroke();

      doc.moveDown(1.5);

      // Transcript Section
      doc
        .fillColor(COLORS.text)
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('Transcript');

      doc.moveDown(0.5);

      let currentQuestion = '';

      for (const msg of data.messages) {
        // Check if we need a new question header
        if (msg.question?.questionText && msg.question.questionText !== currentQuestion) {
          currentQuestion = msg.question.questionText;
          doc.moveDown(0.5);

          // Question header box
          const questionY = doc.y;
          doc
            .rect(doc.page.margins.left, questionY, pageWidth, 30)
            .fill(COLORS.aiBackground);

          doc
            .fillColor(COLORS.primaryDark)
            .fontSize(11)
            .font('Helvetica-Bold')
            .text(`Question ${msg.question.orderIndex + 1}`, doc.page.margins.left + 10, questionY + 8);

          doc.y = questionY + 35;

          doc
            .fillColor(COLORS.text)
            .fontSize(11)
            .font('Helvetica-Oblique')
            .text(currentQuestion, { width: pageWidth - 20 });

          doc.moveDown(0.5);
        }

        // Message
        const isAi = msg.role === 'ai';
        const roleLabel = isAi ? 'AI Interviewer' : 'Candidate';
        const roleColor = isAi ? COLORS.primary : COLORS.primaryDark;

        doc
          .fillColor(roleColor)
          .fontSize(9)
          .font('Helvetica-Bold')
          .text(roleLabel.toUpperCase());

        doc
          .fillColor(COLORS.text)
          .fontSize(10)
          .font('Helvetica')
          .text(msg.content, { width: pageWidth - 20, align: 'left' });

        doc.moveDown(0.8);

        // Check for page break
        if (doc.y > doc.page.height - doc.page.margins.bottom - 100) {
          doc.addPage();
        }
      }

      // Summary Section (if available)
      if (data.summary) {
        doc.addPage();

        doc
          .fillColor(COLORS.text)
          .fontSize(16)
          .font('Helvetica-Bold')
          .text('AI Summary');

        doc.moveDown(0.5);

        // Divider
        doc
          .strokeColor(COLORS.border)
          .lineWidth(1)
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.margins.left + pageWidth, doc.y)
          .stroke();

        doc.moveDown(1);

        // Strengths
        if (data.summary.strengths && data.summary.strengths.length > 0) {
          doc
            .fillColor(COLORS.primaryDark)
            .fontSize(12)
            .font('Helvetica-Bold')
            .text('Strengths');

          doc.moveDown(0.3);

          for (const strength of data.summary.strengths) {
            doc
              .fillColor(COLORS.text)
              .fontSize(10)
              .font('Helvetica')
              .text(`• ${strength}`, { width: pageWidth - 20 });
          }

          doc.moveDown(0.8);
        }

        // Gaps
        if (data.summary.gaps && data.summary.gaps.length > 0) {
          doc
            .fillColor(COLORS.primaryDark)
            .fontSize(12)
            .font('Helvetica-Bold')
            .text('Areas for Improvement');

          doc.moveDown(0.3);

          for (const gap of data.summary.gaps) {
            doc
              .fillColor(COLORS.text)
              .fontSize(10)
              .font('Helvetica')
              .text(`• ${gap}`, { width: pageWidth - 20 });
          }

          doc.moveDown(0.8);
        }

        // Supporting Quotes
        if (data.summary.supportingQuotes && data.summary.supportingQuotes.length > 0) {
          doc
            .fillColor(COLORS.primaryDark)
            .fontSize(12)
            .font('Helvetica-Bold')
            .text('Key Quotes');

          doc.moveDown(0.3);

          for (const quote of data.summary.supportingQuotes) {
            doc
              .fillColor(COLORS.textSecondary)
              .fontSize(10)
              .font('Helvetica-Oblique')
              .text(`"${quote}"`, { width: pageWidth - 20 });
            doc.moveDown(0.3);
          }

          doc.moveDown(0.8);
        }

        // Narrative Summary
        if (data.summary.rawSummary) {
          doc
            .fillColor(COLORS.primaryDark)
            .fontSize(12)
            .font('Helvetica-Bold')
            .text('Narrative Summary');

          doc.moveDown(0.3);

          doc
            .fillColor(COLORS.text)
            .fontSize(10)
            .font('Helvetica')
            .text(data.summary.rawSummary, { width: pageWidth - 20, align: 'left' });
        }
      }

      // Candidate Files (if any)
      if (data.candidateFiles.length > 0) {
        doc.moveDown(1.5);

        doc
          .fillColor(COLORS.primaryDark)
          .fontSize(12)
          .font('Helvetica-Bold')
          .text('Candidate Uploaded Files');

        doc.moveDown(0.3);

        for (const file of data.candidateFiles) {
          doc
            .fillColor(COLORS.text)
            .fontSize(10)
            .font('Helvetica')
            .text(`• ${file.filename} (${file.fileType.toUpperCase()})`);
        }
      }

      // Footer on all pages
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);

        // Page number
        doc
          .fillColor(COLORS.textMuted)
          .fontSize(8)
          .text(
            `Page ${i + 1} of ${pages.count}`,
            doc.page.margins.left,
            doc.page.height - 40,
            { align: 'center', width: pageWidth }
          );

        // Figwork branding
        doc.text(
          'Generated by Figwork',
          doc.page.margins.left,
          doc.page.height - 30,
          { align: 'center', width: pageWidth }
        );
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
