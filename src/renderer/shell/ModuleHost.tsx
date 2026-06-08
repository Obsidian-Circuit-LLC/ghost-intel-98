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
import { SearchModule } from '../modules/search/SearchModule';
import { WhiteboardModule } from '../modules/whiteboard/WhiteboardModule';
import { MediaPlayerModule } from '../modules/media/MediaPlayerModule';
import { GeoIntModule } from '../modules/geoint/GeoIntModule';
import { BookmarksModule } from '../modules/bookmarks/BookmarksModule';
import { MarketsModule } from '../modules/markets/MarketsModule';
import { BriefcaseModule } from '../modules/briefcase/BriefcaseModule';
import { SolitaireModule } from '../modules/solitaire/SolitaireModule';
import { MinesweeperModule } from '../modules/minesweeper/MinesweeperModule';
import { ChessModule } from '../modules/chess/ChessModule';
import { PinballModule } from '../modules/pinball/PinballModule';
import { ChatModule } from '../modules/chat/ChatModule';
import { HelpModule } from '../modules/help/HelpModule';
import { ComingSoon } from '../modules/coming-soon/ComingSoon';

export function ModuleHost({ spec }: { spec: WindowSpec }): JSX.Element {
  switch (spec.module) {
    case 'cases':
      return <CasesModule initialCaseId={spec.props?.['caseId'] as string | undefined} />;
    case 'notepad':
      return (
        <NotepadModule
          initialCaseId={(spec.props?.['caseId'] as string | undefined) ?? null}
          initialNoteName={spec.props?.['initialNoteName'] as string | undefined}
        />
      );
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
    case 'search':
      return <SearchModule />;
    case 'whiteboard':
      return <WhiteboardModule caseId={spec.props?.['caseId'] as string} />;
    case 'media-player':
      return <MediaPlayerModule />;
    case 'geoint':
      return <GeoIntModule />;
    case 'bookmarks':
      return <BookmarksModule />;
    case 'markets':
      return <MarketsModule />;
    case 'briefcase':
      return <BriefcaseModule initialNoteId={spec.props?.['noteId'] as string | undefined} />;
    case 'solitaire':
      return <SolitaireModule />;
    case 'minesweeper':
      return <MinesweeperModule />;
    case 'chess':
      return <ChessModule />;
    case 'pinball':
      return <PinballModule />;
    case 'doc-viewer':
      return (
        <DocViewerModule
          caseId={spec.props?.['caseId'] as string}
          fileName={spec.props?.['fileName'] as string}
          originalName={(spec.props?.['originalName'] as string) ?? (spec.props?.['fileName'] as string)}
        />
      );
    case 'chat':
      return <ChatModule />;
    case 'help':
      return <HelpModule />;
    default:
      return <ComingSoon name={spec.module} detail="No module registered for this key." />;
  }
}
