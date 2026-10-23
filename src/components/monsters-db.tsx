
'use client';

import { useState, useMemo, useEffect, useId } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem } from '@/components/ui/accordion';
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Badge } from '@/components/ui/badge';
import { Skull, PlusCircle, Plus, Pencil, Trash2, ChevronDown, CheckCircle, ImagePlus, Loader2, Filter, Scissors, X, Sparkles } from 'lucide-react';
import { ImageCropperModal } from './image-cropper-modal';
import { ThumbnailFramerModal } from './thumbnail-framer-modal';
import type { Monster } from '@/lib/types';
import { Separator } from './ui/separator';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './ui/form';
import { Textarea } from './ui/textarea';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '@/lib/utils';
import { sanitizeMonsterType, cleanAiHallucinatoryLoops } from '@/lib/formatter';
import * as actions from '@/lib/actions';
import Image from 'next/image';
import { Label } from './ui/label';
import { useToast } from '@/hooks/use-toast';
import { MarkdownRenderer } from './ui/markdown-renderer';

const DetailItem = ({ label, value }: { label: string, value?: React.ReactNode }) => {
    if (!value) return null;
    return <p><strong>{label}:</strong> {String(value)}</p>;
}

function parseAbilityScores(desc?: string) {
  if (!desc) return null;
  const findScore = (names: string[]) => {
    for (const name of names) {
      const regex = new RegExp(`${name}\\s*[:\\s]?\\s*(\\d+)\\s*\\(([+-]?\\d+)\\)`, 'i');
      const match = desc.match(regex);
      if (match) return { score: match[1], mod: match[2] };
      
      const regexSimple = new RegExp(`${name}\\s*[:\\s]?\\s*(\\d+)`, 'i');
      const matchSimple = desc.match(regexSimple);
      if (matchSimple) {
        const scoreVal = parseInt(matchSimple[1], 10);
        const modVal = Math.floor((scoreVal - 10) / 2);
        const modStr = modVal >= 0 ? `+${modVal}` : `${modVal}`;
        return { score: matchSimple[1], mod: modStr };
      }
    }
    return null;
  };

  const str = findScore(['FOR', 'FORZA', 'STR']);
  const dex = findScore(['DES', 'DESTREZZA', 'DEX']);
  const con = findScore(['COS', 'COSTITUZIONE', 'CON']);
  const int = findScore(['INT', 'INTELLIGENZA']);
  const wis = findScore(['SAG', 'SAGGEZZA', 'WIS']);
  const cha = findScore(['CAR', 'CARISMA', 'CHA']);

  if (!str && !dex && !con && !int && !wis && !cha) return null;

  return {
    str: str || { score: '10', mod: '+0' },
    dex: dex || { score: '10', mod: '+0' },
    con: con || { score: '10', mod: '+0' },
    int: int || { score: '10', mod: '+0' },
    wis: wis || { score: '10', mod: '+0' },
    cha: cha || { score: '10', mod: '+0' },
  };
}

const AbilityScoresTable = ({ desc }: { desc?: string }) => {
  const scores = parseAbilityScores(desc);
  if (!scores) return null;
  const items = [
    { label: 'FOR', ...scores.str },
    { label: 'DES', ...scores.dex },
    { label: 'COS', ...scores.con },
    { label: 'INT', ...scores.int },
    { label: 'SAG', ...scores.wis },
    { label: 'CAR', ...scores.cha },
  ];
  return (
    <div className="grid grid-cols-6 gap-1.5 p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/30 text-center font-mono text-xs shadow-sm">
      {items.map((it, idx) => (
        <div key={idx} className="flex flex-col p-1 rounded bg-background/60 border border-border/40">
          <span className="text-[10px] font-bold text-amber-500 uppercase">{it.label}</span>
          <span className="text-xs font-bold text-foreground mt-0.5">{it.score}</span>
          <span className="text-[10px] text-muted-foreground">({it.mod})</span>
        </div>
      ))}
    </div>
  );
};

const monsterSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Il nome è obbligatorio."),
  type: z.string().optional(),
  armorClass: z.string().optional(),
  hitPoints: z.string().optional(),
  challenge: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
});

export type MonsterFormData = z.infer<typeof monsterSchema>;

export function MonsterFormDialog({ monster, campaignId, trigger, onSave }: { monster?: Partial<Monster>, campaignId: string, trigger: React.ReactNode, onSave: (data: MonsterFormData & { campaignId: string }) => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isCropperOpen, setIsCropperOpen] = useState(false);
    const [isFramerOpen, setIsFramerOpen] = useState(false);
    const formId = useId();
    const { toast } = useToast();

    const form = useForm<MonsterFormData>({
        resolver: zodResolver(monsterSchema),
        defaultValues: {
            id: monster?.id,
            name: monster?.name ?? '',
            type: monster?.type ?? '',
            armorClass: monster?.armorClass ?? '',
            hitPoints: monster?.hitPoints ?? '',
            challenge: monster?.challenge ?? '',
            description: monster?.description ?? '',
            imageUrl: monster?.imageUrl ?? '',
            thumbnailUrl: monster?.thumbnailUrl ?? '',
        },
    });
     
    useEffect(() => {
        if(isOpen) {
            form.reset({
                id: monster?.id,
                name: monster?.name ?? '',
                type: monster?.type ?? '',
                armorClass: monster?.armorClass ?? '',
                hitPoints: monster?.hitPoints ?? '',
                challenge: monster?.challenge ?? '',
                description: monster?.description ?? '',
                imageUrl: monster?.imageUrl ?? '',
                thumbnailUrl: monster?.thumbnailUrl ?? '',
            });
        }
    }, [isOpen, monster, form]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
            const currentName = form.getValues('name');
            const result = await actions.uploadGenericImage(event.target?.result as string, currentName);
            if (result.success && result.data) {
                form.setValue('imageUrl', result.data.url);
                toast({ title: "Immagine caricata!" });
            } else {
                toast({ variant: 'destructive', title: "Errore caricamento", description: result.error });
            }
            setIsUploading(false);
        };
        reader.readAsDataURL(file);
    };

    const handleSubmit = async (values: MonsterFormData) => {
        const result = await actions.saveMonster({
            ...values,
            type: sanitizeMonsterType(values.type),
            description: cleanAiHallucinatoryLoops(values.description),
            campaignId
        });

        if (result.success && result.data?.conflict) {
            const confirmed = window.confirm("Un mostro con questo nome esiste già. Vuoi sovrascriverlo?");
            if (!confirmed) return; // Annulla salvataggio

            // Se confermato, procedi con l'aggiornamento usando l'ID esistente
            await actions.saveMonster({
                ...values,
                id: result.data.id,
                type: sanitizeMonsterType(values.type),
                description: cleanAiHallucinatoryLoops(values.description),
                campaignId
            });
        }
        
        onSave({
            ...values,
            type: sanitizeMonsterType(values.type),
            description: cleanAiHallucinatoryLoops(values.description),
            campaignId
        });
        setIsOpen(false);
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="grid grid-rows-[auto_1fr_auto] max-h-[90vh] p-0 sm:max-w-xl">
                <DialogHeader className="p-6 pb-4">
                    <DialogTitle>{monster?.id ? 'Modifica Mostro' : 'Nuovo Mostro'}</DialogTitle>
                    <DialogDescription>Inserisci le statistiche per il tuo mostro personalizzato.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="px-6 border-y">
                <Form {...form}>
                    <form id={formId} onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="flex-1 space-y-4">
                                <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                                <FormField control={form.control} name="type" render={({ field }) => (<FormItem><FormLabel>Tipo</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                            </div>
                            <div className="w-full sm:w-36 space-y-2">
                                <Label>Miniatura / Art</Label>
                                <div className="relative aspect-square bg-black/60 rounded-md overflow-hidden border border-dashed border-muted-foreground/40 flex items-center justify-center group">
                                    {(form.watch('thumbnailUrl') || form.watch('imageUrl')) ? (
                                        <Image src={(form.watch('thumbnailUrl') || form.watch('imageUrl'))!} alt="Anteprima" fill className="object-cover" />
                                    ) : (
                                        <ImagePlus className="h-8 w-8 text-muted-foreground" />
                                    )}
                                    <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" disabled={isUploading} />
                                    {isUploading && <div className="absolute inset-0 bg-background/50 flex items-center justify-center"><Loader2 className="animate-spin" /></div>}
                                </div>
                                <div className="flex items-center flex-wrap gap-1">
                                    {form.watch('imageUrl') && (
                                        <>
                                            <Button 
                                                type="button" 
                                                variant="outline" 
                                                size="sm" 
                                                className="h-6 px-1.5 text-[10px] text-rose-400"
                                                onClick={() => setIsCropperOpen(true)}
                                            >
                                                <Scissors className="h-3 w-3 mr-1" /> Ritaglia
                                            </Button>
                                            <Button 
                                                type="button" 
                                                variant="outline" 
                                                size="sm" 
                                                className="h-6 px-1.5 text-[10px] text-amber-400"
                                                onClick={() => setIsFramerOpen(true)}
                                            >
                                                <Sparkles className="h-3 w-3 mr-1" /> Miniatura
                                            </Button>
                                        </>
                                    )}
                                    <Button type="button" variant="link" size="sm" className="p-0 h-auto text-[10px] text-muted-foreground ml-auto" onClick={() => { form.setValue('imageUrl', ''); form.setValue('thumbnailUrl', ''); }}>Rimuovi</Button>
                                </div>
                            </div>
                        </div>

                        {/* Modale Ritaglio Immagine */}
                        {form.watch('imageUrl') && (
                            <ImageCropperModal
                                isOpen={isCropperOpen}
                                onClose={() => setIsCropperOpen(false)}
                                imageSrc={form.watch('imageUrl')!}
                                title={`Ritaglia - ${form.watch('name') || 'Mostro'}`}
                                onCropSave={(croppedUrl) => {
                                    form.setValue('imageUrl', croppedUrl);
                                    toast({ title: "Immagine ritagliata con successo!" });
                                }}
                            />
                        )}

                        {/* Modale Inquadratura Miniatura */}
                        {form.watch('imageUrl') && (
                            <ThumbnailFramerModal
                                isOpen={isFramerOpen}
                                onClose={() => setIsFramerOpen(false)}
                                imageSrc={form.watch('imageUrl')!}
                                title={`Miniatura - ${form.watch('name') || 'Mostro'}`}
                                onSaveThumbnail={(thumbUrl) => {
                                    form.setValue('thumbnailUrl', thumbUrl);
                                    toast({ title: "Miniatura salvata con successo!" });
                                }}
                            />
                        )}
                        
                        <div className="grid grid-cols-3 gap-4">
                            <FormField control={form.control} name="armorClass" render={({ field }) => (<FormItem><FormLabel>CA</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                            <FormField control={form.control} name="hitPoints" render={({ field }) => (<FormItem><FormLabel>PF</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                            <FormField control={form.control} name="challenge" render={({ field }) => (<FormItem><FormLabel>GS</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        
                        <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Descrizione</FormLabel><FormControl><Textarea className="min-h-[120px]" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)} />
                    </form>
                </Form>
                </ScrollArea>
                <DialogFooter className="p-6 pt-4">
                     <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Annulla</Button>
                    <Button type="submit" form={formId} disabled={form.formState.isSubmitting || isUploading}>{form.formState.isSubmitting ? 'Salvataggio...' : 'Salva'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

interface MonstersDbProps {
    monsters: Monster[];
    campaignId: string;
    possessedItems: string[];
    onSave: (monster: Partial<Monster> & { campaignId: string }) => void;
    onDelete: (idOrName: string, monsterName?: string) => void;
    onTogglePossession: (itemName: string) => void;
}

export function MonstersDb({ monsters, campaignId, possessedItems, onSave, onDelete, onTogglePossession }: MonstersDbProps) {
  const [monsterSearch, setMonsterSearch] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedChallenges, setSelectedChallenges] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'name-asc' | 'name-desc' | 'challenge-asc' | 'challenge-desc'>('name-asc');
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Estrai tipi e gradi di sfida unici dai mostri presenti
  const allTypes = useMemo(() => {
    const typeSet = new Set<string>();
    monsters.forEach(m => {
        if (m.type) {
            const clean = sanitizeMonsterType(m.type);
            if (clean && clean !== 'Mostro') typeSet.add(clean);
        }
    });
    return Array.from(typeSet).sort();
  }, [monsters]);

  const allChallenges = useMemo(() => {
    const challengeSet = new Set<string>();
    monsters.forEach(m => {
        if (m.challenge) {
            challengeSet.add(m.challenge.trim());
        }
    });
    return Array.from(challengeSet).sort((a, b) => {
        const parseCh = (val: string) => {
            if (val.includes('/')) {
                const parts = val.split('/');
                return parseFloat(parts[0]) / parseFloat(parts[1]);
            }
            return parseFloat(val);
        };
        return parseCh(a) - parseCh(b);
    });
  }, [monsters]);

  const handleTypeToggle = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleChallengeToggle = (challenge: string) => {
    setSelectedChallenges(prev => 
      prev.includes(challenge) ? prev.filter(c => c !== challenge) : [...prev, challenge]
    );
  };

  const filteredMonsters = useMemo(() => {
    let items = [...monsters];

    if (selectedTypes.length > 0) {
        items = items.filter(m => m.type && selectedTypes.includes(sanitizeMonsterType(m.type)));
    }

    if (selectedChallenges.length > 0) {
        items = items.filter(m => m.challenge && selectedChallenges.includes(m.challenge.trim()));
    }

    if (monsterSearch) {
      const lowerCaseSearch = monsterSearch.toLowerCase();
      items = items.filter(monster =>
        monster.name.toLowerCase().includes(lowerCaseSearch) ||
        (monster.type?.toLowerCase() ?? '').includes(lowerCaseSearch) ||
        (monster.challenge?.toLowerCase() ?? '').includes(lowerCaseSearch) ||
        (monster.description?.toLowerCase() ?? '').includes(lowerCaseSearch)
      );
    }

    items.sort((a, b) => {
        if (sortBy === 'name-asc') {
            return a.name.localeCompare(b.name, 'it');
        } else if (sortBy === 'name-desc') {
            return b.name.localeCompare(a.name, 'it');
        } else {
            const parseCh = (val?: string) => {
                if (!val) return 0;
                const trimmed = val.trim();
                if (trimmed.includes('/')) {
                    const parts = trimmed.split('/');
                    return parseFloat(parts[0]) / parseFloat(parts[1]);
                }
                return parseFloat(trimmed) || 0;
            };
            const chA = parseCh(a.challenge);
            const chB = parseCh(b.challenge);
            if (sortBy === 'challenge-asc') {
                return chA - chB || a.name.localeCompare(b.name, 'it');
            } else {
                return chB - chA || a.name.localeCompare(b.name, 'it');
            }
        }
    });

    return items;
  }, [monsterSearch, monsters, selectedTypes, selectedChallenges, sortBy]);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex justify-between items-center gap-4">
            <Input
              placeholder="Cerca un mostro per nome, tipo o grado di sfida..."
              value={monsterSearch}
              onChange={(e) => setMonsterSearch(e.target.value)}
              className="flex-1"
            />
            <MonsterFormDialog
                campaignId={campaignId}
                onSave={onSave}
                trigger={<Button size="icon" className="shrink-0"><Plus className="h-4 w-4" /><span className="sr-only">Aggiungi Mostro</span></Button>}
            />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 mt-2 border-t">
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-[10px] uppercase font-bold">
                  <Filter className="mr-2 h-3.5 w-3.5" /> Tipo
                  {selectedTypes.length > 0 && <Badge variant="secondary" className="ml-2 h-4 px-1">{selectedTypes.length}</Badge>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Filtra per Tipo</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ScrollArea className="h-48">
                  {allTypes.map(type => (
                    <DropdownMenuCheckboxItem
                      key={type}
                      checked={selectedTypes.includes(type)}
                      onSelect={(e) => { e.preventDefault(); handleTypeToggle(type); }}
                    >
                      {type}
                    </DropdownMenuCheckboxItem>
                  ))}
                </ScrollArea>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-[10px] uppercase font-bold">
                  <Filter className="mr-2 h-3.5 w-3.5" /> Grado di Sfida (GS)
                  {selectedChallenges.length > 0 && <Badge variant="secondary" className="ml-2 h-4 px-1">{selectedChallenges.length}</Badge>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Filtra per GS</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ScrollArea className="h-48">
                  {allChallenges.map(challenge => (
                    <DropdownMenuCheckboxItem
                      key={challenge}
                      checked={selectedChallenges.includes(challenge)}
                      onSelect={(e) => { e.preventDefault(); handleChallengeToggle(challenge); }}
                    >
                      GS {challenge}
                    </DropdownMenuCheckboxItem>
                  ))}
                </ScrollArea>
              </DropdownMenuContent>
            </DropdownMenu>

            {(selectedTypes.length > 0 || selectedChallenges.length > 0 || monsterSearch) && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSelectedTypes([]); setSelectedChallenges([]); setMonsterSearch(''); }}
                >
                    Reset filtri
                </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
              <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="text-[10px] uppercase font-bold gap-1.5">
                          <span>Ordina:</span>
                          <span className="text-primary font-semibold">
                              {sortBy === 'name-asc' && 'Alfabetico (A-Z)'}
                              {sortBy === 'name-desc' && 'Alfabetico (Z-A)'}
                              {sortBy === 'challenge-asc' && 'GS Crescente'}
                              {sortBy === 'challenge-desc' && 'GS Decrescente'}
                          </span>
                      </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel>Ordinamento</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem checked={sortBy === 'name-asc'} onSelect={() => setSortBy('name-asc')}>
                          Alfabetico (A-Z)
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem checked={sortBy === 'name-desc'} onSelect={() => setSortBy('name-desc')}>
                          Alfabetico (Z-A)
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem checked={sortBy === 'challenge-asc'} onSelect={() => setSortBy('challenge-asc')}>
                          Grado di Sfida (Crescente)
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem checked={sortBy === 'challenge-desc'} onSelect={() => setSortBy('challenge-desc')}>
                          Grado di Sfida (Decrescente)
                      </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
              </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filteredMonsters.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground space-y-2">
                <Skull className="h-10 w-10 mx-auto opacity-40" />
                <p className="text-sm font-medium">Nessun mostro trovato.</p>
                {(selectedTypes.length > 0 || selectedChallenges.length > 0 || monsterSearch) && (
                    <Button variant="link" size="sm" onClick={() => { setSelectedTypes([]); setSelectedChallenges([]); setMonsterSearch(''); }}>
                        Rimuovi filtri e ricerca
                    </Button>
                )}
            </div>
        ) : (
            <Accordion type="single" collapsible className="w-full">
              {filteredMonsters.map((monster) => (
                <AccordionItem value={monster.name} key={monster.name}>
                  <AccordionPrimitive.Header className="flex items-center">
                    <AccordionPrimitive.Trigger className="flex flex-1 items-center justify-between py-4 font-medium text-left transition-all hover:underline [&[data-state=open]>svg]:rotate-180">
                      <div className="flex items-center gap-2.5 flex-wrap">
                          {(monster.thumbnailUrl || monster.imageUrl) && (
                              <div 
                                className="relative w-8 h-8 rounded-md overflow-hidden border border-amber-500/30 bg-black/60 shrink-0 shadow-sm cursor-zoom-in hover:border-amber-500/80 transition-colors"
                                title="Visualizza miniatura a schermo intero"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    setLightboxImage(monster.thumbnailUrl || monster.imageUrl || null);
                                }}
                              >
                                  <img src={monster.thumbnailUrl || monster.imageUrl!} alt={monster.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                          )}
                          <span className="break-words pr-2">{monster.name}</span>
                          {monster.source === 'created' && <Badge variant="secondary"><PlusCircle className="h-3 w-3 mr-1"/>Creato</Badge>}
                          {monster.challenge && <Badge variant="outline">GS {monster.challenge}</Badge>}
                      </div>
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
                    </AccordionPrimitive.Trigger>
                    <div className="flex items-center pl-2 shrink-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Segna come incontrato"
                            onClick={(e) => {
                                e.stopPropagation();
                                onTogglePossession(monster.name);
                            }}
                        >
                            <CheckCircle className={cn('h-5 w-5', possessedItems.includes(monster.name) ? 'text-foreground' : 'text-muted-foreground/60 hover:text-foreground/80')} />
                        </Button>
                        <MonsterFormDialog monster={monster} campaignId={campaignId} onSave={onSave}
                            trigger={<Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="h-4 w-4" /><span className="sr-only">Modifica</span></Button>}
                        />
                    </div>
                  </AccordionPrimitive.Header>
                  <AccordionContent>
                    <div className="space-y-4 pt-2">
                        {/* 1. Prima di tutto: Tabella delle caratteristiche del mostro */}
                        <AbilityScoresTable desc={monster.description} />

                        <div className="flex flex-col sm:flex-row gap-6">
                        {monster.imageUrl && (
                            <div 
                              className="relative w-full sm:w-72 max-h-[420px] rounded-lg overflow-hidden border border-amber-500/30 bg-black/70 flex-shrink-0 cursor-zoom-in hover:border-amber-500/70 transition-colors flex items-center justify-center p-1.5 shadow-md group"
                              title="Visualizza artwork intero a schermo intero"
                              onClick={() => setLightboxImage(monster.imageUrl || null)}
                            >
                                <img 
                                  src={monster.imageUrl} 
                                  alt={monster.name} 
                                  className="max-h-[390px] w-auto max-w-full object-contain rounded transition-transform group-hover:scale-[1.02]" 
                                  referrerPolicy="no-referrer" 
                                />
                                <span className="absolute bottom-2 right-2 text-[9px] bg-black/80 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30 opacity-80 group-hover:opacity-100">
                                  HD Intera
                                </span>
                            </div>
                        )}
                        <div className="flex-grow space-y-3">
                            {/* Dashboard Statistiche Rapide */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-lg bg-amber-950/10 border border-amber-500/10 font-mono text-xs">
                                <div className="space-y-0.5">
                                    <span className="text-muted-foreground block text-[9px] uppercase font-bold tracking-wider">Tipo & Taglia</span>
                                    <span className="font-semibold text-foreground text-xs line-clamp-2" title={sanitizeMonsterType(monster.type) || 'N/D'}>
                                        {sanitizeMonsterType(monster.type) || 'N/D'}
                                    </span>
                                </div>
                                <div className="space-y-0.5">
                                    <span className="text-rose-400/90 block text-[9px] uppercase font-bold tracking-wider">Classe Armatura</span>
                                    <span className="font-semibold text-foreground text-sm">{monster.armorClass || 'N/D'}</span>
                                </div>
                                <div className="space-y-0.5">
                                    <span className="text-emerald-400/90 block text-[9px] uppercase font-bold tracking-wider">Punti Ferita</span>
                                    <span className="font-semibold text-foreground text-sm">{monster.hitPoints || 'N/D'}</span>
                                </div>
                                <div className="space-y-0.5">
                                    <span className="text-amber-400 block text-[9px] uppercase font-bold tracking-wider">Grado di Sfida (GS)</span>
                                    <span className="font-semibold text-foreground text-sm">
                                        {monster.challenge ? `GS ${monster.challenge}` : 'N/D'}
                                    </span>
                                </div>
                            </div>

                            {/* Statblock in Stile Libro dei Mostri */}
                            <div className="relative border-l-4 border-l-amber-600 bg-amber-950/5 p-4 rounded-r-lg border border-border/30 dark:bg-muted/10 font-serif">
                                <h4 className="text-base font-bold text-amber-500 font-sans tracking-wide uppercase border-b border-amber-500/20 pb-1 mb-3">
                                    Statistiche & Tratti
                                </h4>
                                <MarkdownRenderer content={monster.description} className="text-sm leading-relaxed" />
                            </div>
                        </div>
                    </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm"><Trash2 className="mr-2 h-4 w-4" />Elimina Mostro</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Eliminare &quot;{monster.name}&quot;?</AlertDialogTitle>
                                    <AlertDialogDescription>Questa azione rimuoverà permanentemente la creatura dal Bestiario (sia dalla campagna che dal compendio di sistema).</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => onDelete(monster.id || monster.name, monster.name)}>Elimina</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
        )}
      </CardContent>

      {/* Lightbox ad alta risoluzione per le miniature */}
      {lightboxImage && (
        <Dialog open={!!lightboxImage} onOpenChange={(open) => { if (!open) setLightboxImage(null); }}>
          <DialogContent className="max-w-3xl p-1 bg-black/90 border-none overflow-hidden flex items-center justify-center">
            <div className="relative w-full max-h-[80vh] aspect-auto flex items-center justify-center">
              <img 
                src={lightboxImage} 
                alt="Anteprima miniatura" 
                className="max-w-full max-h-[78vh] object-contain rounded" 
                referrerPolicy="no-referrer" 
              />
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-2 right-2 text-white bg-black/40 hover:bg-black/80 rounded-full h-8 w-8" 
                onClick={() => setLightboxImage(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
