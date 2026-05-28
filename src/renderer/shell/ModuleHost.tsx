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
import { NetExplorerModule } from '../modules/net-explorer/NetExplorerModule';
import { MailModule } from '../modules/mail/MailModule';
import { DialTermModule } from '../modules/dialterm/DialTermModule';
import { EyeSpyModule } from '../modules/eyespy/EyeSpyModule';
import { AiAssistantModule } from '../modules/ai-assistant/AiAssistantModule';
import { DocViewerModule } from '../modules/doc-viewer/DocViewerModule';
import { HelpModule } from '../modules/help/HelpModule';
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
      return <NetExplorerModule />;
    case 'mail':
      return <MailModule />;
    case 'dialterm':
      return <DialTermModule />;
    case 'eyespy':
      return <EyeSpyModule />;
    case 'ai-assistant':
      return <AiAssistantModule />;
    case 'doc-viewer':
      return (
        <DocViewerModule
          caseId={spec.props?.['caseId'] as string}
          fileName={spec.props?.['fileName'] as string}
          originalName={(spec.props?.['originalName'] as string) ?? (spec.props?.['fileName'] as string)}
        />
      );
    case 'help':
      return <HelpModule />;
    default:
      return <ComingSoon name={spec.module} detail="No module registered for this key." />;
  }
}
