import { NextResponse } from 'next/server';
import fs from 'fs';
import { getLogFilePath } from '@/lib/logger';

export async function GET() {
  const logPath = getLogFilePath();
  
  if (!fs.existsSync(logPath)) {
    return new NextResponse('Log file not found', { status: 404 });
  }

  const logContent = fs.readFileSync(logPath, 'utf8');
  
  return new NextResponse(logContent, {
    headers: {
      'Content-Type': 'text/plain',
      'Content-Disposition': 'attachment; filename=ai-interactions.log',
    },
  });
}
