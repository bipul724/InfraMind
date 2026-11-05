import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { downloadTextFile } from '@/lib/download';

// The three generated kinds (server/agents/index.js GENERATED_FILES), in display order.
// name: the download name (a browser does not accept a path in a download name);
// path: where the file belongs in the repository, when that differs from the name;
// downloadNote: shown under the file. Chrome drops the leading dot of a download name
// (seen with Chrome 156 on macOS: .env.example is saved as env.example).
const GENERATED_FILE_KINDS: { key: string; name: string; path: string | null; downloadNote: string | null }[] = [
  { key: 'dockerfile', name: 'Dockerfile', path: null, downloadNote: null },
  { key: 'githubActions', name: 'ci.yml', path: '.github/workflows/ci.yml', downloadNote: null },
  { key: 'envExample', name: '.env.example', path: null, downloadNote: 'Chrome saves this file as env.example, without the leading dot. Rename it to .env.example after downloading.' }
];

const lineCount = (content: string): number => {
  if (content === '') return 0;
  const lines = content.split('\n').length;
  return content.endsWith('\n') ? lines - 1 : lines;
};

interface GeneratedFilesViewProps {
  // GET /api/files/:sessionId `files`: kind -> raw file content
  files: Record<string, string>;
  // For log messages only
  sessionId?: string | null;
}

// Each generated file as plain text: a React text child inside <pre><code>, never HTML,
// Markdown or highlighting, so whatever the AI wrote is shown and not run
export const GeneratedFilesView: React.FC<GeneratedFilesViewProps> = ({ files, sessionId }) => {
  const { toast } = useToast();
  const present = GENERATED_FILE_KINDS.filter((kind) => typeof files[kind.key] === 'string');
  const [activeKey, setActiveKey] = useState<string>(present[0]?.key ?? '');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (present.length === 0) return null;
  const selected = present.some((kind) => kind.key === activeKey) ? activeKey : present[0].key;

  const handleCopy = async (key: string, name: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(files[key]);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2000);
      toast({ title: 'Copied', description: `${name} copied to the clipboard.` });
    } catch (error) {
      console.warn(`Copy of ${name} failed (session ${sessionId ?? 'unknown'}):`, error);
      toast({ title: 'Copy failed', description: 'Select the text and copy it manually.', variant: 'destructive' });
    }
  };

  const handleDownload = (key: string, name: string) => {
    try {
      downloadTextFile(name, files[key]);
    } catch (error) {
      console.warn(`Download of ${name} failed (session ${sessionId ?? 'unknown'}):`, error);
      toast({ title: 'Download failed', description: `${name} could not be downloaded.`, variant: 'destructive' });
    }
  };

  return (
    <Tabs value={selected} onValueChange={setActiveKey} className="w-full min-w-0">
      <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
        {present.map((kind) => (
          <TabsTrigger key={kind.key} value={kind.key} className="font-mono text-xs">
            {kind.name}
          </TabsTrigger>
        ))}
      </TabsList>

      {present.map((kind) => {
        const content = files[kind.key];
        const lines = lineCount(content);
        return (
          <TabsContent key={kind.key} value={kind.key} className="mt-3 min-w-0 space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {kind.path ?? kind.name}
                <span className="font-sans"> · {lines} {lines === 1 ? 'line' : 'lines'}</span>
              </p>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => handleCopy(kind.key, kind.name)} aria-label={`Copy ${kind.name}`}>
                  {copiedKey === kind.key ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                  {copiedKey === kind.key ? 'Copied' : 'Copy'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleDownload(kind.key, kind.name)} aria-label={`Download ${kind.name}`}>
                  <Download aria-hidden="true" className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
            {kind.downloadNote && <p className="text-xs leading-5 text-muted-foreground">{kind.downloadNote}</p>}
            <pre
              className="code-surface scrollbar-slim max-h-96 w-full max-w-full overflow-auto whitespace-pre rounded-md border border-border p-4 font-mono text-xs leading-5"
              aria-label={`${kind.name} contents`}
              tabIndex={0}
            >
              <code>{content}</code>
            </pre>
          </TabsContent>
        );
      })}
    </Tabs>
  );
};
