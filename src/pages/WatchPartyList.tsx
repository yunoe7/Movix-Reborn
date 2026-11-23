import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Users, Film, Tv, Loader2
} from 'lucide-react';
import WatchPartyTutorialModal from '../components/WatchPartyTutorialModal';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { WATCHPARTY_API } from '../config/runtime';

const MAIN_API = WATCHPARTY_API;

interface PublicWatchParty {
  id: string;
  code: string;
  title: string;
  poster?: string;
  mediaType: 'movie' | 'tv';
  participantCount: number;
  maxParticipants: number;
  createdAt: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

const WatchPartyList: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [publicParties, setPublicParties] = useState<PublicWatchParty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const fetchPublicParties = async () => {
    try {
      setIsRefreshing(true);
      setError('');
      const response = await axios.get(`${MAIN_API}/api/watchparty/public`);

      if (response.data.success) {
        setPublicParties(response.data.rooms);
      } else {
        setError(t('watchParty.fetchError'));
      }
    } catch (err) {
      console.error('Error fetching public watch parties:', err);
      setError(t('watchParty.fetchErrorGeneric'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPublicParties();

    // Refresh every 30 seconds
    const intervalId = setInterval(fetchPublicParties, 30000);

    return (
    <main className="min-h-screen bg-[#0b0b0b] pb-20 pt-28 text-white md:pt-32">
      <div className="mx-auto w-full max-w-[1760px] px-6 md:px-10">
        <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">Watch Party</h1>
          <p className="mt-3 text-base text-white/65 md:text-lg">
            {t('watchParty.publicPartiesDesc', 'Regardez films et séries entre amis, en synchro')}
          </p>
        </motion.header>

        <section aria-labelledby="watch-party-public-heading">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <h2 id="watch-party-public-heading" className="text-base font-semibold text-white">
              {t('watchParty.publicParties', 'Salles publiques')}
              <span className="ml-2 font-normal tabular-nums text-white/45">{publicParties.length}</span>
            </h2>
            <div className="flex items-center gap-3">
              <Button onClick={handleRefresh} disabled={isRefreshing} variant="secondary" className="h-9 rounded-lg bg-[#4a4a4a] px-4 text-white hover:bg-[#5a5a5a]">
                <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {t('common.refresh', 'Rafraîchir')}
              </Button>
              <Button onClick={() => setShowTutorial(true)} className="h-9 rounded-lg bg-white px-4 font-semibold text-[#151515] hover:bg-white/90">
                <span className="mr-2 text-lg leading-none">+</span>
                {t('watchParty.createRoom', 'Créer une salle')}
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-white/60" /></div>
          ) : error ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-300" role="alert">{error}</div>
          ) : publicParties.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.025] px-6 text-center">
              <Users className="mb-4 h-10 w-10 text-white/25" />
              <p className="text-base font-semibold text-white">{t('watchParty.noPublicParties')}</p>
              <p className="mt-1 max-w-md text-sm text-white/45">{t('watchParty.beFirstToLaunch')}</p>
              <Button onClick={() => setShowTutorial(true)} className="mt-5 h-9 bg-white px-4 text-sm font-semibold text-black hover:bg-white/90">
                + {t('watchParty.createRoom', 'Créer une salle')}
              </Button>
            </div>
          ) : (
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-x-7 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence>
                {publicParties.map((party) => (
                  <motion.article key={party.id} variants={fadeInUp} layout className="group min-w-0 cursor-pointer" onClick={() => handleJoinParty(party.code)}>
                    <div className="relative aspect-video overflow-hidden rounded-xl border border-white/[0.12] bg-[#171717] transition-colors group-hover:border-white/30">
                      {party.poster ? (
                        <img src={party.poster.startsWith('http') ? party.poster : `https://image.tmdb.org/t/p/w500${party.poster}`} alt={party.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" loading="lazy" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#171717]">
                          {party.mediaType === 'movie' ? <Film className="h-10 w-10 text-white/25" /> : <Tv className="h-10 w-10 text-white/25" />}
                        </div>
                      )}
                      <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-black/75 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" /><Users className="h-3 w-3" />{party.participantCount}
                      </div>
                      <div className="absolute right-2 top-2 rounded-md bg-black/75 p-1.5 text-white/90 backdrop-blur-sm" aria-label={t('watchParty.publicRoom', 'Salle publique')}>
                        <Users className="h-3.5 w-3.5" />
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 to-transparent px-3 pb-3 pt-8">
                        <span className="text-xs font-medium text-white/85">{party.mediaType === 'movie' ? t('watchParty.movieLabel') : t('watchParty.seriesLabel')}{party.seasonNumber && party.episodeNumber ? ` · S${party.seasonNumber} E${party.episodeNumber}` : ''}</span>
                        <span className="text-xs text-white/75">{party.participantCount}/{party.maxParticipants}</span>
                      </div>
                    </div>
                    <div className="mt-2 px-0.5">
                      <h3 className="truncate text-sm font-semibold text-white transition-colors group-hover:text-white/75">{party.title}</h3>
                      <p className="mt-0.5 truncate text-xs text-white/45">{formatCreationTime(party.createdAt)}</p>
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      </div>
      <WatchPartyTutorialModal isOpen={showTutorial} onClose={() => setShowTutorial(false)} />
    </main>
  );
};

export default WatchPartyList;
