import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Upload, RotateCw, Shuffle, Sun, Moon, ArrowLeft, ArrowRight, Check, X, Download, List, Eye, EyeOff, Copy, Save, Cloud } from "lucide-react";
import { supabase, StudySet } from "./lib/supabase";

// Types
type QA = { q: string; a: string };

// Utilities
function formatText(text: string): string {
  return text.replace(/([A-E]\.)\s*/g, '\n$1 ');
}

function renderFormattedText(text: string) {
  const parts = text.split('\n').filter(part => part.trim());
  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        const match = part.match(/^([A-E]\.)\s*(.*)/);
        if (match) {
          return (
            <div key={index} className="flex items-start gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-md text-sm font-medium flex-shrink-0">
                {match[1].charAt(0)}
              </span>
              <span className="flex-1 py-1">{match[2]}</span>
            </div>
          );
        }
        return <div key={index} className="mb-3">{part}</div>;
      })}
    </div>
  );
}

function normalizeRecords(records: any[]): QA[] {
  // Accepts: [ [q, a], ... ] or objects with keys 'question','answer','q','a'
  const out: QA[] = [];
  for (const r of records) {
    if (!r) continue;
    if (Array.isArray(r)) {
      const [q, a] = r;
      if (q != null && a != null && String(q).trim() !== "") {
        out.push({ q: formatText(String(q).trim()), a: formatText(String(a ?? "").trim()) });
      }
    } else if (typeof r === "object") {
      const q = r.question ?? r.Question ?? r.Q ?? r.q;
      const a = r.answer ?? r.Answer ?? r.A ?? r.a;
      if (q != null && a != null) {
        out.push({ q: formatText(String(q).trim()), a: formatText(String(a).trim()) });
      } else {
        // Fallback: take first two keys
        const keys = Object.keys(r);
        if (keys.length >= 2) {
          const q2 = r[keys[0]];
          const a2 = r[keys[1]];
          if (q2 != null && a2 != null && String(q2).trim() !== "") {
            out.push({ q: formatText(String(q2).trim()), a: formatText(String(a2).trim()) });
          }
        }
      }
    }
  }
  return out;
}

function downloadJSON(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [rawRows, setRawRows] = useState<QA[]>([]);
  const [queue, setQueue] = useState<number[]>([]); // indices into rawRows
  const [idx, setIdx] = useState(0); // position in queue
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<number[]>([]); // indices of rawRows known
  const [unknown, setUnknown] = useState<number[]>([]); // indices of rawRows unknown (for session)
  const [started, setStarted] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const [reverse, setReverse] = useState(false); // show answer first
  const [dark, setDark] = useState(true);
  const [showList, setShowList] = useState(false);
  const [autoRepeatUnknown, setAutoRepeatUnknown] = useState(true);
  const [savedSets, setSavedSets] = useState<StudySet[]>([]);
  const [currentSetTitle, setCurrentSetTitle] = useState("");
  const [showSavedSets, setShowSavedSets] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // theme
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark"); else root.classList.remove("dark");
  }, [dark]);

  const currentIndex = queue[idx] ?? -1;
  const total = queue.length;
  const progress = total ? Math.round(((idx) / total) * 100) : 0;

  const currentCard = useMemo(() => {
    if (currentIndex < 0) return null;
    const base = rawRows[currentIndex];
    return reverse ? { q: base.a, a: base.q } : base;
  }, [currentIndex, rawRows, reverse]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || !files[0]) return;
    const file = files[0];
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        let records: any[] = [];
        if (Array.isArray(res.data) && res.data.length > 0 && typeof res.data[0] === "object") {
          records = res.data as any[];
        }
        // If all objects are empty due to header=true but CSV has no header, re-parse without header
        const allEmpty = records.length > 0 && records.every(r => Object.values(r).every(v => v === undefined || v === null || String(v).trim() === ""));
        if (allEmpty) {
          Papa.parse(file, {
            header: false,
            skipEmptyLines: true,
            complete: (res2) => {
              const arr = (res2.data as any[]).map(r => Array.isArray(r) ? r.slice(0,2) : r);
              const qas = normalizeRecords(arr);
              setRawRows(qas);
              resetSession(qas.length);
            }
          });
        } else {
          const qas = normalizeRecords(records);
          setRawRows(qas);
          resetSession(qas.length);
        }
      },
      error: () => {
        alert("CSV 파싱에 실패했습니다. 파일 형식을 확인해주세요.");
      }
    });
  }, []);

  const resetSession = (n: number) => {
    const base = Array.from({ length: n }, (_, i) => i);
    const q = shuffle ? shuffleArray(base) : base;
    setQueue(q);
    setIdx(0);
    setFlipped(false);
    setKnown([]);
    setUnknown([]);
    setStarted(false);
  };

  function shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  };

  const onKey = useCallback((e: KeyboardEvent) => {
    if (!started) return;
    if (e.key === " " || e.code === "Space") { e.preventDefault(); setFlipped(f => !f); }
    if (e.key === "ArrowRight") { next(); }
    if (e.key === "ArrowLeft") { prev(); }
    if (e.key === "1") { markKnown(); }
    if (e.key === "2") { markUnknown(); }
  }, [started, idx, queue]);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const startSession = () => setStarted(true);

  const next = () => {
    if (idx < queue.length - 1) { setIdx(i => i + 1); setFlipped(false); }
  };
  const prev = () => {
    if (idx > 0) { setIdx(i => i - 1); setFlipped(false); }
  };

  const markKnown = () => {
    const i = currentIndex; if (i < 0) return;
    if (!known.includes(i)) setKnown(k => [...k, i]);
    if (autoRepeatUnknown) {
      // ensure it's removed from unknown if present
      setUnknown(u => u.filter(x => x !== i));
    }
    next();
  };
  const markUnknown = () => {
    const i = currentIndex; if (i < 0) return;
    if (!unknown.includes(i)) setUnknown(u => [...u, i]);
    // Put it back later near the end (spaced repetition-lite)
    if (autoRepeatUnknown) {
      setQueue(q => {
        const copy = [...q];
        // append this index again in ~5 cards ahead
        const insertAt = Math.min(copy.length, idx + 5 + Math.floor(Math.random()*3));
        copy.splice(insertAt, 0, i);
        return copy;
      });
    }
    next();
  };

  const exportProgress = () => {
    downloadJSON("flashcards_progress.json", { known, unknown, total: rawRows.length, timestamp: new Date().toISOString() });
  };

  const copyOriginalText = () => {
    if (currentCard) {
      const originalQ = rawRows[currentIndex]?.q.replace(/\n/g, ' ');
      const originalA = rawRows[currentIndex]?.a.replace(/\n/g, ' ');
      const text = `${originalQ}\n\n정답: ${originalA}`;
      navigator.clipboard.writeText(text);
      alert('원문이 클립보드에 복사되었습니다!');
    }
  };

  const saveStudySet = async () => {
    if (!currentSetTitle.trim() || rawRows.length === 0) {
      alert('제목과 문제를 입력해주세요.');
      return;
    }
    
    const studySet: StudySet = {
      title: currentSetTitle,
      questions: rawRows.map(row => ({
        question: row.q,
        answer: row.a
      }))
    };
    
    const { error } = await supabase
      .from('study_sets')
      .insert([studySet]);
    
    if (error) {
      alert('저장 실패: ' + error.message);
    } else {
      alert('저장되었습니다!');
      loadSavedSets();
    }
  };

  const loadSavedSets = async () => {
    const { data, error } = await supabase
      .from('study_sets')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      setSavedSets(data);
    }
  };

  const loadStudySet = (studySet: StudySet) => {
    const qas = studySet.questions.map(q => ({
      q: formatText(q.question),
      a: formatText(q.answer)
    }));
    setRawRows(qas);
    resetSession(qas.length);
    setCurrentSetTitle(studySet.title);
    setShowSavedSets(false);
  };

  useEffect(() => {
    loadSavedSets();
  }, []);

  const filePicker = () => fileInputRef.current?.click();

  const sampleCSV = `question,answer\nHTTP는 무상태(Stateless) 프로토콜이다,true\nAWS에서 객체 스토리지는 무엇인가?,Amazon S3\nTCP 3-way handshake의 단계는?,SYN -> SYN/ACK -> ACK`;

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50 transition-colors">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <header className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">CSV 플래시카드 🎓</h1>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2" onClick={() => setShowSavedSets(!showSavedSets)}>
              <Cloud size={16} /> 저장된 세트
            </Button>
            <div className="flex items-center gap-2">
              <Sun size={18} />
              <Switch checked={dark} onCheckedChange={setDark} />
              <Moon size={18} />
            </div>
            <Button variant="outline" className="gap-2" onClick={() => resetSession(rawRows.length)}>
              <RotateCw size={16} /> 초기화
            </Button>
          </div>
        </header>

        {/* Saved Sets */}
        {showSavedSets && (
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">저장된 학습 세트</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-60 overflow-auto">
                {savedSets.map((set) => (
                  <div key={set.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium">{set.title}</div>
                      <div className="text-sm text-neutral-500">{set.questions.length}개 문제</div>
                    </div>
                    <Button size="sm" onClick={() => loadStudySet(set)}>불러오기</Button>
                  </div>
                ))}
                {savedSets.length === 0 && (
                  <div className="text-center text-neutral-500 py-8">저장된 세트가 없습니다.</div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upload / Dropzone */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">CSV 업로드</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
              onClick={filePicker}
            >
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              <div className="flex flex-col items-center gap-2">
                <Upload />
                <p className="font-medium">여기에 CSV 파일을 끌어다 놓거나 클릭해서 선택</p>
                <p className="text-sm text-neutral-500">형식: <code>질문,정답</code> (헤더로 <code>question,answer</code> 사용 가능)</p>
                <Button variant="secondary" size="sm" className="mt-2" onClick={(e) => { e.stopPropagation(); const blob = new Blob([sampleCSV], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "sample.csv"; a.click(); URL.revokeObjectURL(url); }}>샘플 CSV 받기</Button>
              </div>
            </div>

            {rawRows.length > 0 && (
              <div className="mt-4 space-y-4">
                <div className="flex gap-2">
                  <Input 
                    placeholder="학습 세트 제목" 
                    value={currentSetTitle} 
                    onChange={(e) => setCurrentSetTitle(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={saveStudySet} className="gap-2">
                    <Save size={16} /> 저장
                  </Button>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shuffle size={16} />
                      <Label className="text-sm">셔플</Label>
                    </div>
                    <Switch checked={shuffle} onCheckedChange={setShuffle} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RotateCw size={16} />
                      <Label className="text-sm">모르면 재등장</Label>
                    </div>
                    <Switch checked={autoRepeatUnknown} onCheckedChange={setAutoRepeatUnknown} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <EyeOff size={16} />
                      <Label className="text-sm">Q/A 뒤집기 (답 먼저 보기)</Label>
                    </div>
                    <Switch checked={reverse} onCheckedChange={setReverse} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={startSession} disabled={started} className="w-full">학습 시작</Button>
                  </div>
                </div>
                <div className="rounded-xl border p-3 text-sm max-h-48 overflow-auto bg-neutral-50 dark:bg-neutral-900">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium flex items-center gap-2"><List size={16}/> 미리보기</div>
                    <div className="text-xs text-neutral-500">총 {rawRows.length}개</div>
                  </div>
                  <ul className="space-y-2">
                    {rawRows.slice(0, 10).map((r, i) => (
                      <li key={i} className="flex gap-2"><span className="text-neutral-500">{i+1}.</span><span className="truncate">{r.q}</span><span className="text-neutral-500">→</span><span className="truncate">{r.a}</span></li>
                    ))}
                    {rawRows.length > 10 && <li className="text-neutral-500">... 나머지 {rawRows.length - 10}개</li>}
                  </ul>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Study Area */}
        {rawRows.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg">학습</CardTitle>
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex items-center gap-1"><Check size={16}/> {known.length}</span>
                  <span className="flex items-center gap-1"><X size={16}/> {unknown.length}</span>
                  <span className="flex items-center gap-1"><Eye size={16}/> {started ? `${idx+1}/${queue.length}` : `0/${queue.length}`}</span>
                  <Button variant="outline" size="icon" onClick={exportProgress} title="진행도 저장(다운로드)"><Download size={16}/></Button>
                  <Button variant="outline" size="icon" onClick={() => setShowList(s => !s)} title="목록 토글"><List size={16}/></Button>
                </div>
              </div>
              <Progress value={progress} className="h-2 mt-3" />
            </CardHeader>
            <CardContent>
              {started ? (
                <div className="grid gap-4">
                  <div className="grid lg:grid-cols-[2fr,300px] gap-4 items-start">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={`${currentIndex}-${flipped}-${reverse}`}
                        initial={{ opacity: 0, y: 8, rotateX: 10 }}
                        animate={{ opacity: 1, y: 0, rotateX: 0 }}
                        exit={{ opacity: 0, y: -8, rotateX: -10 }}
                        transition={{ duration: 0.2 }}
                        className="rounded-2xl border shadow-sm p-6 bg-white dark:bg-neutral-900 min-h-[220px] flex flex-col justify-between"
                      >
                        <div className="flex justify-between items-center mb-2">
                          <div className="text-xs text-neutral-500">카드를 눌러 뒤집기 · Space</div>
                          <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={copyOriginalText}>
                            <Copy size={12} /> 원문 복사
                          </Button>
                        </div>
                        <div className="flex-1 flex items-start justify-start text-left">
                          <div onClick={() => setFlipped(f => !f)} className="cursor-pointer select-none w-full">
                            {!flipped ? (
                              <div>
                                <div className="text-sm text-neutral-500 mb-2">문제</div>
                                <div className="text-lg sm:text-xl font-semibold">{renderFormattedText(currentCard?.q || '')}</div>
                              </div>
                            ) : (
                              <div>
                                <div className="text-sm text-neutral-500 mb-2">정답</div>
                                <div className="text-lg sm:text-xl font-semibold">{renderFormattedText(currentCard?.a || '')}</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-4">
                          <Button variant="outline" className="gap-2" onClick={prev} disabled={idx===0}><ArrowLeft size={16}/> 이전(←)</Button>
                          <div className="flex gap-2">
                            <Button variant="destructive" className="gap-2" onClick={markUnknown}><X size={16}/> 모르겠음(2)</Button>
                            <Button variant="default" className="gap-2" onClick={markKnown}><Check size={16}/> 알겠음(1)</Button>
                          </div>
                          <Button variant="outline" className="gap-2" onClick={next} disabled={idx>=queue.length-1}><ArrowRight size={16}/> 다음(→)</Button>
                        </div>
                      </motion.div>
                    </AnimatePresence>

                    {/* Side Info */}
                    <div className="rounded-2xl border p-4 bg-neutral-50 dark:bg-neutral-900">
                      <div className="font-medium mb-2">단축키</div>
                      <ul className="text-sm space-y-1 text-neutral-600 dark:text-neutral-300">
                        <li>Space: 카드 뒤집기</li>
                        <li>1: 알겠음, 2: 모르겠음</li>
                        <li>← / →: 이전 / 다음</li>
                      </ul>
                      <div className="h-px bg-neutral-200 dark:bg-neutral-800 my-3"/>
                      <div className="text-sm">
                        <div className="font-medium mb-2">세션 옵션</div>
                        <div className="flex items-center justify-between mb-2"><span className="text-neutral-500">셔플</span><Switch checked={shuffle} onCheckedChange={(v)=>{setShuffle(v); resetSession(rawRows.length);}}/></div>
                        <div className="flex items-center justify-between mb-2"><span className="text-neutral-500">모르면 재등장</span><Switch checked={autoRepeatUnknown} onCheckedChange={setAutoRepeatUnknown}/></div>
                        <div className="flex items-center justify-between"><span className="text-neutral-500">Q/A 뒤집기</span><Switch checked={reverse} onCheckedChange={setReverse}/></div>
                      </div>
                    </div>
                  </div>

                  {/* List */}
                  {showList && (
                    <div className="rounded-2xl border p-4 bg-neutral-50 dark:bg-neutral-900 max-h-[300px] overflow-auto">
                      <div className="font-medium mb-2">전체 목록</div>
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-950">
                          <tr className="text-left text-neutral-500">
                            <th className="px-2 py-1 w-12">#</th>
                            <th className="px-2 py-1">문제</th>
                            <th className="px-2 py-1">정답</th>
                          </tr>
                        </thead>
                        <tbody>
                          {queue.map((ri, i) => (
                            <tr key={i} className={`border-t border-neutral-200 dark:border-neutral-800 ${i===idx?"bg-amber-50 dark:bg-amber-900/20": ""}`}>
                              <td className="px-2 py-1">{i+1}</td>
                              <td className="px-2 py-1 truncate">{rawRows[ri]?.q}</td>
                              <td className="px-2 py-1 truncate text-neutral-500">{rawRows[ri]?.a}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-neutral-500 p-8">CSV를 업로드하고 <span className="font-medium">학습 시작</span>을 눌러주세요.</div>
              )}
            </CardContent>
          </Card>
        )}

        {rawRows.length === 0 && (
          <Card className="mt-4">
            <CardContent className="p-4 text-sm text-neutral-600 dark:text-neutral-300">
              <p className="mb-2">📌 CSV 규칙</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>각 줄은 <code>문제,정답</code> 2개 컬럼으로 구성합니다.</li>
                <li>헤더가 있다면 <code>question,answer</code> 또는 <code>q,a</code> 형태를 권장합니다.</li>
                <li>쉼표가 포함된 텍스트는 <code>"따옴표"</code>로 감싸세요.</li>
              </ul>
            </CardContent>
          </Card>
        )}

        <footer className="text-center text-xs text-neutral-500 mt-6">
          클라이언트에서만 동작합니다. 파일은 서버로 업로드되지 않아요.
        </footer>
      </div>
    </div>
  );
}