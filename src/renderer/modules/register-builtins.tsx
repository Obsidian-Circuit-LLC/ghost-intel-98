/**
 * Seed every built-in module into the ModuleRegistry.
 * This is the single source of truth for built-in modules; the compile-time
 * switch in ModuleHost.tsx will be replaced by registry lookups in Task 8.
 *
 * Prop-passing adapters replicate ModuleHost.tsx's per-module wiring exactly.
 */

import { registerModule } from '../state/registry';
import type { WindowSpec } from '../state/store';
import { CasesModule } from './cases/CasesModule';
import { NotepadModule } from './notepad/NotepadModule';
import { CalendarModule } from './calendar/CalendarModule';
import { RemindersModule } from './reminders/RemindersModule';
import { AlarmModule } from './alarm/AlarmModule';
import { ShredModule } from './shred/ShredModule';
import { SettingsModule } from './settings/SettingsModule';
import { NetExplorerModule } from './net-explorer/NetExplorerModule';
import { MailModule } from './mail/MailModule';
import { DialTermModule } from './dialterm/DialTermModule';
import { EyeSpyModule } from './eyespy/EyeSpyModule';
import { AiAssistantModule } from './ai-assistant/AiAssistantModule';
import { DocViewerModule } from './doc-viewer/DocViewerModule';
import { SearchModule } from './search/SearchModule';
import { WhiteboardModule } from './whiteboard/WhiteboardModule';
import { MediaPlayerModule } from './media/MediaPlayerModule';
import { GeoIntModule } from './geoint/GeoIntModule';
import { BookmarksModule } from './bookmarks/BookmarksModule';
import { MarketsModule } from './markets/MarketsModule';
import { BriefcaseModule } from './briefcase/BriefcaseModule';
import { JournalModule } from './journal/JournalModule';
import { SolitaireModule } from './solitaire/SolitaireModule';
import { MinesweeperModule } from './minesweeper/MinesweeperModule';
import { ChessModule } from './chess/ChessModule';
import { PinballModule } from './pinball/PinballModule';
import { ChatModule } from './chat/ChatModule';
import { CameraViewModule } from './cameraview/CameraViewModule';
import { HostInfoModule } from './hostinfo/HostInfoModule';
import { NewsViewModule } from './geoint/NewsViewModule';
import { HelpModule } from './help/HelpModule';
import { SearchlightModule } from './searchlight/SearchlightModule';
import { SocmintModule } from './socmint/SocmintModule';
import { XCollectorModule } from './x/XCollectorModule';

// ---------------------------------------------------------------------------
// Adapter components — each has the uniform { spec: WindowSpec } signature and
// replicates the prop-passing from ModuleHost.tsx's switch arms verbatim.
// ---------------------------------------------------------------------------

function CasesAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <CasesModule initialCaseId={spec.props?.['caseId'] as string | undefined} />;
}

function NotepadAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return (
    <NotepadModule
      initialCaseId={(spec.props?.['caseId'] as string | undefined) ?? null}
      initialNoteName={spec.props?.['initialNoteName'] as string | undefined}
    />
  );
}

function CalendarAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <CalendarModule />;
}

function RemindersAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <RemindersModule highlight={spec.props?.['highlight'] as string | undefined} />;
}

function AlarmAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <AlarmModule />;
}

function ShredAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <ShredModule />;
}

function SettingsAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <SettingsModule />;
}

function NetExplorerAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <NetExplorerModule />;
}

function MailAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <MailModule />;
}

function DialTermAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <DialTermModule />;
}

function EyeSpyAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <EyeSpyModule />;
}

function AiAssistantAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <AiAssistantModule />;
}

function SearchAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <SearchModule />;
}

function WhiteboardAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <WhiteboardModule caseId={spec.props?.['caseId'] as string} />;
}

function MediaPlayerAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <MediaPlayerModule />;
}

function GeoIntAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <GeoIntModule />;
}

function BookmarksAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <BookmarksModule />;
}

function MarketsAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <MarketsModule />;
}

function BriefcaseAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <BriefcaseModule initialNoteId={spec.props?.['noteId'] as string | undefined} />;
}

function JournalAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <JournalModule />;
}

function SolitaireAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <SolitaireModule />;
}

function MinesweeperAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <MinesweeperModule />;
}

function ChessAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <ChessModule />;
}

function PinballAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <PinballModule />;
}

function DocViewerAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return (
    <DocViewerModule
      caseId={spec.props?.['caseId'] as string}
      fileName={spec.props?.['fileName'] as string}
      originalName={(spec.props?.['originalName'] as string) ?? (spec.props?.['fileName'] as string)}
    />
  );
}

function ChatAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <ChatModule />;
}

function CameraViewAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <CameraViewModule stream={spec.props?.['stream'] as import('@shared/post-mvp-types').CameraStream} />;
}

function HostInfoAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <HostInfoModule stream={spec.props?.['stream'] as import('@shared/post-mvp-types').CameraStream} />;
}

function NewsViewAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <NewsViewModule stream={spec.props?.['stream'] as import('./geoint/NewsStreamView').NewsStream} />;
}

function HelpAdapter({ spec: _spec }: { spec: WindowSpec }): JSX.Element {
  return <HelpModule />;
}

function SearchlightAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <SearchlightModule caseId={spec.props?.['caseId'] as string | undefined} />;
}

function SocmintAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <SocmintModule caseId={spec.props?.['caseId'] as string | undefined} />;
}

function XCollectorAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <XCollectorModule caseId={spec.props?.['caseId'] as string | undefined} />;
}

// ---------------------------------------------------------------------------
// Registration
// Titles are VERBATIM from Desktop.tsx moduleTitles.
// Glyphs are VERBATIM from Icon.tsx GLYPHS.
// ---------------------------------------------------------------------------

export function registerBuiltins(): void {
  registerModule({ key: 'cases',        title: 'My Cases',         glyph: '📁', component: CasesAdapter,        builtin: true });
  registerModule({ key: 'notepad',      title: 'Notepad 98',       glyph: '🗒', component: NotepadAdapter,      builtin: true });
  registerModule({ key: 'calendar',     title: 'Calendar',         glyph: '📅', component: CalendarAdapter,     builtin: true });
  registerModule({ key: 'reminders',    title: 'Reminders',        glyph: '🔔', component: RemindersAdapter,    builtin: true });
  registerModule({ key: 'alarm',        title: 'Alarm',            glyph: '⏰', component: AlarmAdapter,        builtin: true });
  registerModule({ key: 'shred',        title: 'Shred',            glyph: '🗑', component: ShredAdapter,        builtin: true });
  registerModule({ key: 'settings',     title: 'Settings',         glyph: '⚙', component: SettingsAdapter,     builtin: true });
  registerModule({ key: 'net-explorer', title: 'Net Explorer',     glyph: '🌐', component: NetExplorerAdapter,  builtin: true });
  registerModule({ key: 'mail',         title: 'Mail',             glyph: '✉', component: MailAdapter,         builtin: true });
  registerModule({ key: 'dialterm',     title: 'DialTerm',         glyph: '📞', component: DialTermAdapter,     builtin: true });
  registerModule({ key: 'eyespy',       title: 'EyeSpy',           glyph: '📷', component: EyeSpyAdapter,       builtin: true });
  registerModule({ key: 'ai-assistant', title: 'AI Assistant',     glyph: '✨', component: AiAssistantAdapter,  builtin: true });
  registerModule({ key: 'doc-viewer',   title: 'Document Viewer',  glyph: '📄', component: DocViewerAdapter,    builtin: true });
  registerModule({ key: 'search',       title: 'Search',           glyph: '🔍', component: SearchAdapter,       builtin: true });
  registerModule({ key: 'whiteboard',   title: 'Whiteboard',       glyph: '🗺', component: WhiteboardAdapter,   builtin: true });
  registerModule({ key: 'media-player', title: 'Jukebox',          glyph: '🎵', component: MediaPlayerAdapter,  builtin: true, defaultWidth: 720, defaultHeight: 840 });
  registerModule({ key: 'geoint',       title: 'GeoINT',           glyph: '🌍', component: GeoIntAdapter,       builtin: true });
  registerModule({ key: 'bookmarks',    title: 'Bookmarks',        glyph: '🔖', component: BookmarksAdapter,    builtin: true });
  registerModule({ key: 'markets',      title: 'Markets',          glyph: '📈', component: MarketsAdapter,      builtin: true });
  registerModule({ key: 'briefcase',    title: 'Briefcase',        glyph: '💼', component: BriefcaseAdapter,    builtin: true });
  registerModule({ key: 'journal',      title: 'Journal Jots',     glyph: '📓', component: JournalAdapter,      builtin: true });
  registerModule({ key: 'solitaire',    title: 'Solitaire',        glyph: '🃏', component: SolitaireAdapter,    builtin: true });
  registerModule({ key: 'minesweeper',  title: 'Mine Detector',    glyph: '💣', component: MinesweeperAdapter,  builtin: true });
  registerModule({ key: 'chess',        title: 'Chess',            glyph: '♟', component: ChessAdapter,        builtin: true });
  registerModule({ key: 'pinball',      title: 'Ghost Space Ball',   glyph: '🕹', component: PinballAdapter,      builtin: true });
  registerModule({ key: 'chat',         title: 'Chat (beta)',      glyph: '💬', component: ChatAdapter,         builtin: true });
  registerModule({ key: 'camera-view', title: 'Camera', glyph: '📹', component: CameraViewAdapter, builtin: true, defaultWidth: 480, defaultHeight: 360 });
  registerModule({ key: 'host-info', title: 'Host Info', glyph: '🖥', component: HostInfoAdapter, builtin: true, defaultWidth: 460, defaultHeight: 360 });
  registerModule({ key: 'news-view', title: 'News', glyph: '📺', component: NewsViewAdapter, builtin: true, defaultWidth: 640, defaultHeight: 480 });
  registerModule({ key: 'help',         title: 'RTFM',             glyph: '?',  component: HelpAdapter,         builtin: true });
  registerModule({ key: 'searchlight', title: 'Searchlight', glyph: '🔎', component: SearchlightAdapter, builtin: true, defaultWidth: 1100, defaultHeight: 720 });
  registerModule({ key: 'socmint', title: 'SOCMINT', glyph: '📡', component: SocmintAdapter, builtin: true, defaultWidth: 900, defaultHeight: 640 });
  registerModule({ key: 'x', title: 'X / Twitter', glyph: '✖', component: XCollectorAdapter, builtin: true, defaultWidth: 900, defaultHeight: 640 });
}
