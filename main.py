import json, re, os, logging, sys
from typing import List, Optional, Dict, AsyncGenerator
from collections import defaultdict
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import StreamingResponse
import chromadb
from chromadb.utils import embedding_functions
import ollama
from pyarabic.araby import strip_tashkeel, normalize_ligature

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger("myproj")

# ── Config ────────────────────────────────────────────────────
OLLAMA_MODEL    = os.getenv('ZAJAL_LLM',       'qwen2.5:7b-instruct-q4_K_M')
EMBED_MODEL     = os.getenv('ZAJAL_EMBED',     'paraphrase-multilingual-MiniLM-L12-v2')
CHROMA_PATH     = os.getenv('ZAJAL_CHROMA',    './chroma_db')
CHROMA_COLLECTION = os.getenv('ZAJAL_COLLECTION', 'zajal_lines_v2')
SONGS_FILE      = os.getenv('ZAJAL_SONGS',     'songs.json')
# ─────────────────────────────────────────────────────────────

app = FastAPI(title='Zajal Heritage Platform', version='4.1')
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

def normalize_arabic(text: str) -> str:
    if not text: return ''
    text = strip_tashkeel(text)
    text = normalize_ligature(text)
    text = re.sub(r'[ـًٌٍَُِّْ]', '', text)
    return re.sub(r'\s+', ' ', text).strip()

def extract_rhyme(line: str, length: int = 2) -> str:
    words = [w for w in normalize_arabic(line).split() if w]
    if not words: return ''
    last_word = words[-1]
    n = min(length, len(last_word))
    return last_word[-n:] if n > 0 else ''

def load_songs_data():
    """
    Load ALL song data once at startup into a dict keyed by song_id.
    Handles both single-collection {songs: [...]} and multi-collection [{songs: [...]}, ...]
    O(1) lookups instead of repeated file reads per result.
    """
    try:
        with open(SONGS_FILE, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)

        songs_dict = {}
        song_titles = {}
        song_years = {}
        all_collections_metadata = []  # store ALL poets' metadata

        # Handle list of collections (new format) or single collection (old format)
        collections = data if isinstance(data, list) else [data]

        for collection in collections:
            meta = collection.get('project_metadata', {})
            if meta:
                all_collections_metadata.append(meta)
            for song in collection.get('songs', []):
                song_id = song['song_id']
                songs_dict[song_id] = song
                song_titles[song_id] = song['metadata']['arabic_title']
                song_years[song_id] = song['metadata'].get('year_composed', 1950)

        logger.info(f' Loaded {len(songs_dict)} songs from {len(collections)} collection(s)')
        return songs_dict, song_titles, song_years, all_collections_metadata
    except Exception as e:
        logger.error(f' Error loading song data: {e}')
        sys.exit(1)


class ZajalRAG:
    def __init__(self):
        self.client = chromadb.PersistentClient(path=CHROMA_PATH)
        self.rhyme_index = defaultdict(list)

        self.songs_dict, self.song_titles, self.song_years, self.all_collections_metadata = load_songs_data()

        self.ef = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=EMBED_MODEL
        )
        logger.info(' Using multilingual embeddings (paraphrase-multilingual-MiniLM-L12-v2)')

        self.collection = self.client.get_or_create_collection(
            name=CHROMA_COLLECTION,
            embedding_function=self.ef,
            metadata={'hnsw:space': 'cosine'}
        )

        if self.collection.count() == 0:
            self._ingest()
        else:
            existing = self.collection.get(include=['metadatas'])
            for meta in existing['metadatas']:
                self.rhyme_index[meta['rhyme_ending']].append(meta['chunk_id'])
            logger.info(f' Loaded {self.collection.count()} lines from ChromaDB')

    def _ingest(self):
        logger.info(' Ingesting Zajal content into ChromaDB...')
        docs, metas, ids = [], [], []
        chunk_id = 0

        def add_chunk(text, meta, id_str):
            nonlocal chunk_id
            if not text or not text.strip(): return
            docs.append(normalize_arabic(text))
            metas.append(meta)
            ids.append(id_str)
            chunk_id += 1

        # ── 1. Biographical chunks from project_metadata ──────────────────
        for col_meta in self.all_collections_metadata:
            singer = col_meta.get('singer', {})
            poet_name = singer.get('arabic_name', '')
            if not poet_name: continue

            bio_text = ' '.join(filter(None, [
                singer.get('cultural_significance', ''),
                singer.get('nickname', ''),
                singer.get('troupe', ''),
                col_meta.get('connection_to_zgheib', ''),
                ' '.join(singer.get('published_works', []))
            ]))

            add_chunk(bio_text, {
                'chunk_id': f'chunk_{chunk_id}',
                'chunk_type': 'biography',
                'song_id': f'bio_{poet_name}',
                'title': f'سيرة {poet_name}',
                'singer': poet_name,
                'themes': 'سيرة,شاعر,تراث',
                'region': singer.get('nationality', 'Lebanon'),
                'line_num': 0,
                'original': bio_text[:300],
                'rhyme_ending': '_bio_',
                'copyright_status': 'public_domain',
                'year_composed': singer.get('birth_year', 1900)
            }, f'bio_{poet_name}_main')

        # ── 2. Per-song chunks ─────────────────────────────────────────────
        for song_id, song in self.songs_dict.items():
            poet = song['creators'].get('poet', song['creators'].get('singer', 'مجهول'))
            title = song['metadata']['arabic_title']
            year = song['metadata'].get('year_composed', 1950)
            themes = ','.join(song['thematic_analysis']['primary_themes'])
            region = song['metadata'].get('region', 'Levant')

            base_meta = {
                'song_id': song_id,
                'title': title,
                'singer': poet,
                'themes': themes,
                'region': region,
                'rhyme_ending': '_meta_',
                'copyright_status': song.get('copyright_status', 'public_domain'),
                'year_composed': year,
                'line_num': 0,
            }

            # 2a. Historical context
            hc = song.get('historical_context', {})
            hc_text = ' '.join(filter(None, [
                hc.get('historical_event', ''),
                hc.get('cultural_significance', ''),
                hc.get('social_impact', ''),
                hc.get('political_context', '')
            ]))
            add_chunk(hc_text, {**base_meta,
                'chunk_id': f'chunk_{chunk_id}',
                'chunk_type': 'historical_context',
                'original': hc_text[:300],
                'rhyme_ending': '_hist_'
            }, f'{song_id}_historical')

            # 2b. Thematic + symbolic analysis
            ta = song.get('thematic_analysis', {})
            symbols = ' | '.join([
                f"{s.get('symbol','')} — {s.get('meaning','')}"
                for s in ta.get('symbolic_imagery', [])
            ])
            emotional = ', '.join(ta.get('emotional_tone', []))
            identity = ', '.join(ta.get('cultural_identity_markers', []))
            thematic_text = ' '.join(filter(None, [symbols, emotional, identity]))

            add_chunk(thematic_text, {**base_meta,
                'chunk_id': f'chunk_{chunk_id}',
                'chunk_type': 'thematic',
                'original': thematic_text[:300],
                'rhyme_ending': '_theme_'
            }, f'{song_id}_thematic')

            # 2c. Poetic + musical analysis
            pa = song.get('poetic_analysis', {})
            ma = song.get('musical_analysis', {})
            analysis_text = ' '.join(filter(None, [
                pa.get('form', ''),
                pa.get('dialect_features', ''),
                ' '.join(pa.get('literary_devices', [])),
                ma.get('genre', ''),
                ma.get('maqam', ''),
                ma.get('vocal_technique', '')
            ]))
            add_chunk(analysis_text, {**base_meta,
                'chunk_id': f'chunk_{chunk_id}',
                'chunk_type': 'analysis',
                'original': analysis_text[:300],
                'rhyme_ending': '_anal_'
            }, f'{song_id}_analysis')

            # 2d. Vector search metadata (pre-built searchable text)
            vsm = song.get('vector_search_metadata', {})
            vsm_text = ' '.join(filter(None, [
                vsm.get('searchable_themes', ''),
                vsm.get('searchable_context', ''),
                vsm.get('searchable_analysis', '')
            ]))
            add_chunk(vsm_text, {**base_meta,
                'chunk_id': f'chunk_{chunk_id}',
                'chunk_type': 'search_metadata',
                'original': vsm_text[:300],
                'rhyme_ending': '_vsm_'
            }, f'{song_id}_vsm')

            # 2e. Full poetry lines (original behaviour)
            for idx, line in enumerate(song.get('full_lines', [])):
                if not line or not line.strip(): continue
                rhyme = extract_rhyme(line)
                if not rhyme: rhyme = '_no_rhyme_'
                cid = f'chunk_{chunk_id}'
                add_chunk(line, {**base_meta,
                    'chunk_id': cid,
                    'chunk_type': 'poetry_line',
                    'original': line,
                    'rhyme_ending': rhyme,
                    'line_num': idx + 1
                }, f'{song_id}_line{idx}')
                self.rhyme_index[rhyme].append(cid)

        if docs:
            # Batch insert to avoid memory issues
            batch_size = 100
            for i in range(0, len(docs), batch_size):
                self.collection.add(
                    documents=docs[i:i+batch_size],
                    metadatas=metas[i:i+batch_size],
                    ids=ids[i:i+batch_size]
                )
            logger.info(f' Ingested {len(docs)} chunks from {len(self.songs_dict)} songs')
        else:
            logger.error(' No valid content to ingest!')

    def _format_symbols(self, symbols):
        if not symbols: return "لا يوجد رموز مسجلة"
        return ' | '.join([f"{s.get('symbol', '')} = {s.get('meaning', '')}" for s in symbols[:2]])

    def _format_citations(self, citations):
        if not citations: return "لا يوجد مصادر بحثية"
        return f"{citations[0].get('citation', 'مرجع بحثي')[:60]}..."

    def _enrich(self, m: dict) -> dict:
        """
        Build a rich result dict from a ChromaDB metadata row.
        Uses O(1) dict lookup instead of file I/O.
        """
        song_full = self.songs_dict.get(m['song_id'], {})
        return {
            'title': m['title'],
            'singer': m['singer'],
            'line': m['original'],
            'themes': m['themes'].split(',') if m['themes'] else [],
            'region': m['region'],
            'rhyme_ending': m['rhyme_ending'],
            'song_id': m['song_id'],
            'year_composed': m.get('year_composed', '?'),
            'historical_event': song_full.get('historical_context', {}).get('historical_event', 'تراث شعبي'),
            'symbolic_imagery': self._format_symbols(song_full.get('thematic_analysis', {}).get('symbolic_imagery', [])),
            'poetic_form': song_full.get('poetic_analysis', {}).get('form', 'زجل'),
            'maqam': song_full.get('musical_analysis', {}).get('maqam', 'غير محدد'),
            'research_citations': self._format_citations(song_full.get('research_sources', [])),
            'chunk_type': m.get('chunk_type', 'poetry_line')
        }

    def _poet_names(self) -> dict:
        """Return mapping of arabic name variations → poet identifier for all ingested poets."""
        names = {}
        for col_meta in self.all_collections_metadata:
            arabic_name = col_meta.get('singer', {}).get('arabic_name', '')
            if arabic_name:
                names[normalize_arabic(arabic_name)] = arabic_name
                # also add first name and last name separately
                parts = arabic_name.split()
                for part in parts:
                    if len(part) > 2:
                        names[normalize_arabic(part)] = arabic_name
        return names

    def _fetch_structured_chunks(self, query: str, chunk_types: list) -> list:
        """
        Structured lookup: fetch biography/historical/thematic chunks for poets
        mentioned by name in the query. No semantic guessing — direct filter.
        """
        query_norm = normalize_arabic(query)
        poet_name_map = self._poet_names()
        mentioned_poets = set()

        for name_norm, arabic_name in poet_name_map.items():
            if name_norm in query_norm:
                mentioned_poets.add(arabic_name)

        if not mentioned_poets:
            # no specific poet mentioned → fetch all biography chunks
            mentioned_poets = {m.get('singer', {}).get('arabic_name', '')
                               for m in self.all_collections_metadata
                               if m.get('singer', {}).get('arabic_name')}

        results = []
        seen_ids = set()
        for poet in mentioned_poets:
            for ctype in chunk_types:
                try:
                    rows = self.collection.get(
                        where={"$and": [
                            {"chunk_type": {"$eq": ctype}},
                            {"singer": {"$eq": poet}}
                        ]},
                        limit=3
                    )['metadatas']
                    for m in rows:
                        uid = m.get('chunk_id', '') + m.get('song_id', '')
                        if uid not in seen_ids:
                            seen_ids.add(uid)
                            r = self._enrich(m)
                            r['relevance'] = 1.0
                            results.append(r)
                except Exception as e:
                    logger.warning(f"Structured fetch error ({ctype}/{poet}): {e}")
        return results

    def search(self, query=None, rhyme=None, theme=None, singer=None, region=None, year_composed=None, top_k=5):
        where = {}
        if theme: where['themes'] = {'$contains': normalize_arabic(theme)}
        if singer: where['singer'] = normalize_arabic(singer)
        if region: where['region'] = normalize_arabic(region)
        if year_composed is not None:
            where['year_composed'] = {'$gte': year_composed}
        if rhyme:
            target = extract_rhyme(rhyme)
            candidates = self.rhyme_index.get(target, [])
            if candidates:
                where['chunk_id'] = {'$in': candidates}

        try:
            seen_ids = set()
            final_results = []

            def add_results(items):
                for r in items:
                    uid = r.get('song_id', '') + r.get('line', '')[:30]
                    if uid not in seen_ids:
                        seen_ids.add(uid)
                        final_results.append(r)

            if query:
                query_norm = normalize_arabic(query)

                # ── A. Structured lookup: biography + historical + thematic ──
                # These are factual chunks — retrieved by filter, not vector similarity.
                # This is how we get mentor/student, historical events, etc. reliably.
                structural_chunk_types = ['biography', 'historical_context', 'thematic', 'search_metadata']
                structured = self._fetch_structured_chunks(query, structural_chunk_types)
                add_results(structured[:2])  # at most 2 structured chunks upfront
                logger.info(f" Structured retrieval: {len(structured)} chunks")

                # ── B. Forced title match: song title in query → fetch its lines ──
                forced = []
                for song_id, title in self.song_titles.items():
                    if normalize_arabic(title) in query_norm:
                        song_chunks = self.collection.get(
                            where={"$and": [{"song_id": {"$eq": song_id}}, {"chunk_type": {"$eq": "poetry_line"}}]},
                            limit=6
                        )['metadatas']
                        forced.extend(song_chunks)
                        logger.info(f" Title match: '{title}' ({len(song_chunks)} lines)")
                if forced:
                    enriched_forced = [self._enrich(m) for m in forced]
                    for r in enriched_forced: r['relevance'] = 1.0
                    add_results(enriched_forced)

                # ── C. Semantic search for poetry lines ──
                remaining = top_k - len(final_results)
                if remaining > 0:
                    poetry_where = {"chunk_type": {"$eq": "poetry_line"}}
                    if where:
                        poetry_where = {"$and": [{"chunk_type": {"$eq": "poetry_line"}}] + [
                            {k: v} for k, v in where.items()
                        ]}
                    try:
                        sem = self.collection.query(
                            query_texts=[query_norm],
                            where=poetry_where,
                            n_results=min(remaining * 2, 40)
                        )
                        for m, d in zip(sem['metadatas'][0], sem['distances'][0]):
                            r = self._enrich(m)
                            r['relevance'] = round(1 - d, 3)
                            add_results([r])
                    except Exception as e:
                        logger.warning(f"Semantic search error: {e}")

            else:
                rows = self.collection.get(where=where if where else None, limit=top_k)
                for m in rows['metadatas']:
                    r = self._enrich(m)
                    r['relevance'] = 1.0
                    add_results([r])

            return final_results[:top_k]

        except Exception as e:
            logger.error(f' Search error: {e}')
            raise


    def _fetch_song_context(self, query: str) -> tuple:
        """
        If a song title is mentioned in the query, return (song_id, full song dict).
        Otherwise return (None, None).
        Uses songs_dict directly — no ChromaDB involved.
        """
        query_norm = normalize_arabic(query)
        for song_id, title in self.song_titles.items():
            if normalize_arabic(title) in query_norm:
                logger.info(f" Song-specific fetch: '{title}'")
                return song_id, self.songs_dict[song_id]
        return None, None

    def build_song_prompt(self, message: str, song: dict) -> str:
        """Build a rich prompt using the complete song object — used for song-specific queries."""
        title    = song['metadata']['arabic_title']
        year     = song['metadata'].get('year_composed', '?')
        poet     = song['creators'].get('poet', song['creators'].get('singer', 'مجهول'))
        album    = song['metadata'].get('album', '')
        hist     = song.get('historical_context', {})
        ta       = song.get('thematic_analysis', {})
        pa       = song.get('poetic_analysis', {})
        ma       = song.get('musical_analysis', {})
        lines    = '\n'.join(song.get('full_lines', []))
        symbols  = ' | '.join([
            f"{s.get('symbol','')} = {s.get('meaning','')}"
            for s in ta.get('symbolic_imagery', [])
        ])
        themes   = ', '.join(ta.get('primary_themes', []))
        tone     = ', '.join(ta.get('emotional_tone', []))
        devices  = ', '.join(pa.get('literary_devices', []))

        context = (
            f"【القصيدة】 {title} ({year}) — {poet}\n"
            f"【الديوان】 {album}\n"
            f"【السياق التاريخي】 {hist.get('historical_event', '')}\n"
            f"【الأهمية الثقافية】 {hist.get('cultural_significance', '')}\n"
            f"【المواضيع】 {themes}\n"
            f"【النبرة العاطفية】 {tone}\n"
            f"【الرموز】 {symbols}\n"
            f"【الشكل الشعري】 {pa.get('form', '')} | المقام: {ma.get('maqam', '')}\n"
            f"【الأساليب الأدبية】 {devices}\n"
            f"【الأبيات الكاملة】\n{lines}"
        )

        prompt  = "أنت د. زجّال، أستاذ متخصص في الأدب الزجلي اللبناني.\n\n"
        prompt += "IMPORTANT: You MUST respond ONLY in Arabic. Never use Chinese or English.\n\n"
        prompt += "قواعد الإجابة:\n"
        prompt += "١. ابدأ بجملة تلخّص الإجابة مباشرة\n"
        prompt += "٢. استشهد بأبيات محددة من القصيدة لدعم كل نقطة\n"
        prompt += "٣. اربط الرموز بسياقها التاريخي والثقافي\n"
        prompt += "٤. لا تتجاوز ٣٠٠ كلمة\n"
        prompt += "٥. أجب بالعربية الفصحى فقط\n\n"
        prompt += f"القصيدة الكاملة وتحليلها:\n{context}\n\n"
        prompt += f"السؤال: {message}\n\n"
        prompt += "الإجابة الأكاديمية بالعربية فقط:"
        return prompt

    def build_prompt(self, message: str, context: list) -> str:
        poetry_chunks = [c for c in context if c.get('chunk_type') == 'poetry_line']
        meta_chunks   = [c for c in context if c.get('chunk_type') != 'poetry_line']

        meta_lines = []
        for c in meta_chunks:
            ctype = c.get('chunk_type', '').upper()
            meta_lines.append("[" + ctype + "] " + c["title"] + " — " + c["line"][:250])
        meta_block = ("\n【معلومات سياقية وبيوغرافية】\n" + "\n".join(meta_lines)) if meta_lines else ""

        poetry_lines = []
        for c in poetry_chunks:
            poetry_lines.append(
                "\"" + c["line"] + "\" ← " + c["singer"] + " (" + c["title"] + ", " + str(c["year_composed"]) + ")\n"
                + "السياق: " + c["historical_event"] + " | الرمز: " + c["symbolic_imagery"]
            )
        poetry_block = ("\n【أبيات شعرية】\n" + "\n\n".join(poetry_lines)) if poetry_lines else ""

        context_str = meta_block + poetry_block

        prompt = "أنت د. زجّال، أستاذ متخصص في الأدب الزجلي اللبناني.\n\n"
        prompt += "IMPORTANT: You MUST respond ONLY in Arabic. Never use Chinese or English. If you respond in any language other than Arabic, it is a critical failure.\n\n"
        prompt += "قواعد الإجابة:\n"
        prompt += "١. ابدأ دائماً بجملة تلخّص الإجابة مباشرة\n"
        prompt += "٢. قسّم إجابتك إلى فقرات واضحة بعناوين قصيرة\n"
        prompt += "٣. استشهد دائماً بسطر شعري من السياق أدناه لدعم كل نقطة\n"
        prompt += "٤. اذكر اسم الشاعر وسنة القصيدة عند الاستشهاد\n"
        prompt += "٥. اختم بجملة تربط الموضوع بالهوية الثقافية اللبنانية\n"
        prompt += "٦. لا تتجاوز ٢٥٠ كلمة\n"
        prompt += "٧. أجب بالعربية الفصحى فقط — ممنوع منعاً باتاً استخدام أي لغة أخرى\n\n"
        prompt += "السياق الأكاديمي:\n" + context_str + "\n\n"
        prompt += "السؤال: " + message + "\n\n"
        prompt += "الإجابة الأكاديمية بالعربية فقط:"
        return prompt


rag = ZajalRAG()


class SearchReq(BaseModel):
    rhyme_pattern: Optional[str] = None
    theme: Optional[str] = None
    singer: Optional[str] = None
    region: Optional[str] = None
    year_composed: Optional[int] = None
    top_k: int = 30


class ChatReq(BaseModel):
    message: str
    context_lines: int = 4  # Increased from 3 — more songs = richer answers
    stream: bool = True


@app.get('/')
async def frontend(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get('/api')
def api_root():
    return {
        'status': 'operational',
        'project': 'myproj',
        'db': f'ChromaDB ({rag.collection.count()} Zajal lines)',
        'songs': len(rag.song_titles),
        'endpoints': ['/search', '/chat', '/chat/stream', '/health', '/api']
    }


@app.get('/health')
def health():
    try:
        ollama.list()
        ollama_ok = True
    except:
        ollama_ok = False
    return {
        'chromadb': rag.collection.count() > 0,
        'ollama': ollama_ok,
        'songs_in_memory': len(rag.songs_dict),
        'embedding_model': EMBED_MODEL
    }


@app.get('/api/poems')
def api_poems():
    """Return all poems formatted for the timeline — built from songs_dict at runtime."""
    poems = []
    for song_id, song in rag.songs_dict.items():
        ta    = song.get('thematic_analysis', {})
        ma    = song.get('musical_analysis', {})
        hc    = song.get('historical_context', {})
        poet  = song['creators'].get('poet', song['creators'].get('singer', ''))
        lines = song.get('full_lines', [])

        # Map full theme names to short color-map keys
        SHORT_THEMES = {
            'الطبيعة': 'طبيعة', 'طبيعة': 'طبيعة',
            'الوطن': 'وطن', 'وطن': 'وطن',
            'الحب': 'حب', 'حب': 'حب',
            'الهجرة': 'هجرة', 'هجرة': 'هجرة',
            'الحرب': 'حرب', 'حرب': 'حرب',
            'الحكمة': 'حكمة', 'حكمة': 'حكمة',
            'الفلسفة': 'فلسفة', 'فلسفة': 'فلسفة',
            'الغزل': 'غزل', 'غزل': 'غزل',
            'الظلم': 'ظلم', 'ظلم': 'ظلم',
            'العدالة': 'عدالة', 'عدالة': 'عدالة',
            'الدين': 'دين', 'دين': 'دين',
            'الموت': 'موت', 'موت': 'موت',
            'التاريخ': 'تاريخ', 'تاريخ': 'تاريخ',
            'الهوية': 'هوية', 'هوية': 'هوية',
            'السياسة': 'سياسة', 'سياسة': 'سياسة',
            'فلسطين': 'فلسطين', 'المقاومة': 'مقاومة', 'مقاومة': 'مقاومة',
            'الفداء': 'فداء', 'فداء': 'فداء',
            'الكرامة': 'كرامة', 'كرامة': 'كرامة',
            'الغربة': 'غربة', 'غربة': 'غربة',
            'الحنين': 'حنين', 'حنين': 'حنين',
            'الشيخوخة': 'شيخوخة', 'شيخوخة': 'شيخوخة',
            'الأنوثة': 'أنوثة', 'أنوثة': 'أنوثة',
            'الإرث': 'إرث', 'إرث': 'إرث',
            'الكتابة': 'كتابة', 'كتابة': 'كتابة',
            'المرأة': 'مرأة', 'مرأة': 'مرأة',
            'الذاكرة': 'ذاكرة', 'ذاكرة': 'ذاكرة',
        }
        def short_theme(t):
            for k, v in SHORT_THEMES.items():
                if k in t or t in k:
                    return v
            return t

        raw_themes = ta.get('primary_themes', [])[:2]
        short_themes = [short_theme(t) for t in raw_themes]

        poems.append({
            'id':     song_id,
            'title':  song['metadata']['arabic_title'],
            'poet':   'zgheib' if 'زغيب' in poet else 'rokz',
            'year':   song['metadata'].get('year_composed', 1950),
            'themes': short_themes,
            'maqam':  ma.get('maqam', ''),
            'hist':   hc.get('historical_event', ''),
            'lines':  lines[:2],
        })

    # Sort by year
    poems.sort(key=lambda p: p['year'])
    return {'poems': poems}


@app.get('/audio/{song_id}')
async def check_audio(song_id: str):
    """Check if audio file exists for a song and return its URL."""
    audio_path = f'static/audio/{song_id}.mp3'
    if os.path.exists(audio_path):
        return {'available': True, 'url': f'/static/audio/{song_id}.mp3'}
    return {'available': False}


@app.post('/search')
def search(req: SearchReq):
    """
    Structured search on songs_dict — returns one result per song, not per line.
    Filters: singer, theme, region, year, rhyme.
    No vectors, no semantic search.
    """
    try:
        # No filters = return all songs

        matched_songs = []

        for song_id, song in rag.songs_dict.items():
            meta   = song.get('metadata', {})
            ta     = song.get('thematic_analysis', {})
            poet   = song['creators'].get('poet', song['creators'].get('singer', ''))
            themes = ta.get('primary_themes', [])
            region = meta.get('region', '')
            year   = meta.get('year_composed', 0)

            # ── Filter: singer ──
            if req.singer and normalize_arabic(req.singer) not in normalize_arabic(poet):
                continue

            # ── Filter: theme ──
            if req.theme:
                theme_norm = normalize_arabic(req.theme)
                if not any(theme_norm in normalize_arabic(t) for t in themes):
                    continue

            # ── Filter: region ──
            if req.region and normalize_arabic(req.region) not in normalize_arabic(region):
                continue

            # ── Filter: year ──
            if req.year_composed and year < req.year_composed:
                continue

            # ── Filter: rhyme ──
            if req.rhyme_pattern:
                target = extract_rhyme(req.rhyme_pattern)
                # check if any line in this song ends with this rhyme
                song_rhymes = [
                    extract_rhyme(line)
                    for line in song.get('full_lines', [])
                    if line.strip()
                ]
                if target not in song_rhymes:
                    continue

            # ── Build result object ──
            hc  = song.get('historical_context', {})
            pa  = song.get('poetic_analysis', {})
            ma  = song.get('musical_analysis', {})
            symbols = ' | '.join([
                f"{s.get('symbol','')} = {s.get('meaning','')}"
                for s in ta.get('symbolic_imagery', [])[:2]
            ])

            matched_songs.append({
                'song_id':          song_id,
                'title':            meta.get('arabic_title', ''),
                'singer':           poet,
                'year_composed':    year,
                'album':            meta.get('album', ''),
                'themes':           themes,
                'region':           region,
                'maqam':            ma.get('maqam', ''),
                'poetic_form':      pa.get('form', ''),
                'historical_event': hc.get('historical_event', ''),
                'cultural_significance': hc.get('cultural_significance', ''),
                'symbolic_imagery': symbols,
                'emotional_tone':   ta.get('emotional_tone', []),
                'preview_lines':    song.get('full_lines', [])[:3],
                'total_lines':      len(song.get('full_lines', [])),
                'copyright_status': song.get('copyright_status', ''),
                'source_url':       meta.get('source_url', '')
            })

        matched_songs = matched_songs[:req.top_k]
        return {'success': True, 'count': len(matched_songs), 'results': matched_songs}

    except Exception as e:
        raise HTTPException(500, str(e))


@app.post('/chat')
def chat(req: ChatReq):
    """Non-streaming chat endpoint (kept for compatibility)"""
    try:
        # Song-specific fetch: if a song title is in the query, use the complete song
        song_id, song = rag._fetch_song_context(req.message)
        if song:
            prompt = rag.build_song_prompt(req.message, song)
            sources = [{'title': song['metadata']['arabic_title'], 'singer': song['creators'].get('poet', ''), 'song_id': song_id, 'chunk_type': 'full_song'}]
        else:
            context = rag.search(query=req.message, top_k=req.context_lines)
            if not context:
                return {
                    'answer': 'لم أجد معلومات كافية. جرّب سؤالاً أكثر تحديداً مثل: "ما رمزية الزيتون في أغنية يا ديرتي؟"',
                    'sources': [],
                    'model': 'deterministic'
                }
            prompt = rag.build_prompt(req.message, context)
            sources = context

        num_ctx = 4096 if song else 2048  # song prompts are longer, need more context window

        try:
            resp = ollama.generate(
                model=OLLAMA_MODEL,
                prompt=prompt,
                options={
                    'temperature': 0.15,
                    'num_ctx': num_ctx,
                    'num_thread': 6
                }
            )
            ans = resp['response'].strip()

            if not ans or len(ans) < 50:
                ans = 'لم أتمكن من توليد إجابة. جرّب سؤالاً أكثر تحديداً.'

            return {'answer': ans, 'sources': sources, 'model': 'qwen2.5:7b-q4_K_M'}

        except Exception as e:
            err = str(e).lower()
            if 'not found' in err or 'model' in err:
                return {
                    'answer': 'النموذج غير متوفر. شغّل: ollama pull qwen2.5:7b-instruct-q4_K_M',
                    'sources': sources,
                    'model': 'unavailable'
                }
            return {'answer': f'خطأ في النموذج: {str(e)[:100]}', 'sources': sources, 'model': 'error'}

    except Exception as e:
        raise HTTPException(500, str(e))


@app.post('/chat/stream')
async def chat_stream(req: ChatReq):
    """
    Streaming SSE endpoint.
    Tokens arrive in real-time instead of waiting for the full response.

    SSE format:
        data: {"token": "..."}\n\n              — each token as it's generated
        data: {"sources": [...], "done": true}\n\n  — final message with sources
    """
    # Song-specific fetch: if a song title is in the query, use the complete song
    song_id, song = rag._fetch_song_context(req.message)
    if song:
        prompt  = rag.build_song_prompt(req.message, song)
        sources = [{'title': song['metadata']['arabic_title'], 'singer': song['creators'].get('poet', ''), 'song_id': song_id, 'chunk_type': 'full_song'}]
        num_ctx = 4096
    else:
        context = rag.search(query=req.message, top_k=req.context_lines)
        if not context:
            async def empty_stream():
                yield 'data: {"token": "لم أجد معلومات كافية. جرّب سؤالاً أكثر تحديداً."}\n\n'
                yield 'data: {"done": true, "sources": []}\n\n'
            return StreamingResponse(empty_stream(), media_type='text/event-stream')
        prompt  = rag.build_prompt(req.message, context)
        sources = context
        num_ctx = 2048

    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            stream = ollama.generate(
                model=OLLAMA_MODEL,
                prompt=prompt,
                stream=True,
                options={
                    'temperature': 0.15,
                    'num_ctx': num_ctx,
                    'num_thread': 6
                }
            )
            for chunk in stream:
                token = chunk.get('response', '')
                if token:
                    payload = json.dumps({'token': token}, ensure_ascii=False)
                    yield f'data: {payload}\n\n'

            sources_payload = json.dumps({'done': True, 'sources': sources}, ensure_ascii=False)
            yield f'data: {sources_payload}\n\n'

        except Exception as e:
            err_payload = json.dumps({'error': str(e)[:100]}, ensure_ascii=False)
            yield f'data: {err_payload}\n\n'

    return StreamingResponse(
        generate_stream(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )


if __name__ == '__main__':
    import uvicorn
  
    print('\n Open: http://localhost:8000')

    uvicorn.run(app, host='127.0.0.1', port=8000)