/**
 * Routes a WindowSpec.module key to the right React component.
 * One switch keeps the App tree dumb — modules are otherwise self-contained.
 */

import type { WindowSpec } from '../state/store';
import { CasesModule } from '../modules/cases/CasesModule';
import { NotepadModule } from '../modules/notepad/NotepadModule';
import { CalendarModule } from '../modules/calendar/CalendarModule';
import { RemindersModule } from '../modules/reminders/RemindersModule';
import { AlarmModule } from '../modules/alarm/AlarmModule';
import { ShredModule } from '../modules/shred/ShredModule';
import { SettingsModule } from '../modules/settings/SettingsModule';
import { ComingSoon } from '../modules/coming-soon/ComingSoon';

export function ModuleHost({ spec }: { spec: WindowSpec }): JSX.Element {
  switch (spec.module) {
    case 'cases':
      return <CasesModule />;
    case 'notepad':
      return <NotepadModule initialCaseId={(spec.props?.['caseId'] as string | undefined) ?? null} />;
    case 'calendar':
      return <CalendarModule />;
    case 'reminders':
      return <RemindersModule highlight={spec.props?.['highlight'] as string | undefined} />;
    case 'alarm':
      return <AlarmModule />;
    case 'shred':
      return <ShredModule />;
    case 'settings':
      return <SettingsModule />;
    case 'net-explorer':
      return <ComingSoon name="Net Explorer" detail="Internal browser — coming in v1.0.0." />;
    case 'mail':
      return <ComingSoon name="Mail" detail="IMAP/SMTP client — coming in v1.0.0." />;
    case 'dialterm':
      return <ComingSoon name="DialTerm" detail="SSH client with dial-up handshake — coming in v1.0.0." />;
    case 'eyespy':
      return <ComingSoon name="EyeSpy" detail="Authorised camera streams — coming in v1.0.0." />;
    case 'ai-assistant':
      return <ComingSoon name="AI Assistant" detail="Pluggable Ollama / OpenAI-compatible — coming in v1.0.0." />;
    default:
      return <ComingSoon name={spec.module} detail="No module registered for this key." />;
  }
}
