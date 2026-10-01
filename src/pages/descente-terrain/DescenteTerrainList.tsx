import { useCallback, useEffect, useState } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonRefresher, IonRefresherContent,
  IonList, IonItem, IonLabel, IonBadge, IonSpinner, IonFab, IonFabButton, IonIcon,
  IonToast, IonButton, IonSearchbar,
} from '@ionic/react';
import { add, syncOutline, cloudOfflineOutline } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { descenteTerrainApi } from '../../services/descenteTerrainService';
import { db, type PendingOperation } from '../../services/db';
import { synchroniserTout } from '../../services/syncService';
import { useOnline } from '../../hooks/useOnline';
import type { DescenteTerrainDTO, Page } from '../../types/descenteTerrain';

const COULEURS_STATUT: Record<string, string> = {
  conforme: '#059669',
  'non conforme': '#dc2626',
  'en attente': '#b7791f',
  'occupation illicite': '#c53030',
  'construction illegale': '#7c3aed',
};

const COULEURS_VALIDATION: Record<string, string> = {
  'en attente': '#b7791f',
  valide: '#059669',
  rejete: '#dc2626',
  'complement demande': '#8b5cf6',
};

export default function DescenteTerrainList() {
  const history = useHistory();
  const online = useOnline();

  const [items, setItems] = useState<DescenteTerrainDTO[]>([]);
  const [page, setPage] = useState<Page<DescenteTerrainDTO> | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [pendingItems, setPendingItems] = useState<PendingOperation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger'>('success');

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const data = search.trim()
        ? await descenteTerrainApi.rechercher(search.trim(), currentPage, 25)
        : await descenteTerrainApi.lister(currentPage, 25);
      setItems(data.content);
      setPage(data);
    } catch {
      setItems([]);
      setPage(null);
    } finally {
      setLoading(false);
    }
  }, [search, currentPage]);

  useEffect(() => { charger(); }, [charger]);

  const rechargerFileLocale = useCallback(async () => {
    try {
      const [n, liste] = await Promise.all([
        db.nombreOperationsPending(),
        db.listerOperationsPending(),
      ]);
      setPending(n);
      setPendingItems(liste.filter((op) => op.entiteType === 'descente_terrain' && op.action === 'CREATE'));
    } catch { /* base indisponible */ }
  }, []);

  useEffect(() => { rechargerFileLocale(); }, [online, rechargerFileLocale]);

  const handleRefresh = async (e: CustomEvent) => {
    await charger();
    (e.target as HTMLIonRefresherElement).complete();
  };

  const synchroniser = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await synchroniserTout();
      setToast(
        res.total === 0
          ? 'Rien à synchroniser'
          : `${res.reussis}/${res.total} opération(s) envoyée(s)${res.echecs ? ` — ${res.echecs} échec(s)` : ''}${res.photosRefilees ? ` — ${res.photosRefilees} photo(s) à renvoyer` : ''}`
      );
      setToastColor(res.echecs > 0 ? 'danger' : 'success');
      if (res.reussis > 0) await charger();
    } catch {
      setToast('Synchronisation impossible (hors-ligne ?)');
      setToastColor('danger');
    } finally {
      setSyncing(false);
      rechargerFileLocale();
    }
  }, [syncing, charger, rechargerFileLocale]);

  useEffect(() => {
    if (online && pending > 0) {
      synchroniser();
    }
  }, [online]);

  const formaterDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  const couleurStatut = useCallback(
    (code?: string) => COULEURS_STATUT[(code || '').toLowerCase()] || '#6b7280',
    [],
  );

  const couleurValidation = useCallback(
    (code?: string) => COULEURS_VALIDATION[(code || '').toLowerCase()] || '#6b7280',
    [],
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#0d435d', '--color': 'white', '--min-height': online ? '56px' : '94px' }}>
          <IonTitle>📋 Descente terrain</IonTitle>
          {!online && (
            <div style={{ fontSize: 12, padding: '4px 12px', textAlign: 'center', color: '#8a6d1d' }}>
              📴 Hors-ligne — {pending > 0 ? `${pending} en attente` : 'aucune donnée locale'}
            </div>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <IonSearchbar
          value={search}
          onIonInput={(e) => { setSearch(String(e.detail.value || '')); setCurrentPage(0); }}
          placeholder="Référence, demandeur, dossier…"
          debounce={400}
        />

        {pending > 0 && (
          <div style={{ margin: '4px 12px 8px', background: '#fff8e1', border: '1px solid #f0e0a8', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IonIcon icon={cloudOfflineOutline} style={{ color: '#b7791f', fontSize: 20 }} />
            <div style={{ flex: 1, fontSize: 12.5, color: '#8a6d1d' }}>
              <b>{pending}</b> descente(s) enregistrée(s) sur l'appareil
            </div>
            <IonButton size="small" color="warning" onClick={synchroniser} disabled={!online || syncing}>
              {syncing ? <IonSpinner name="crescent" /> : <IonIcon icon={syncOutline} slot="start" />}
              {syncing ? '' : 'Sync'}
            </IonButton>
          </div>
        )}

        {pendingItems.length > 0 && (
          <div style={{ margin: '0 12px 8px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8a6d1d', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 2px 6px' }}>
              📴 Sur cet appareil ({pendingItems.length})
            </div>
            <IonList style={{ border: '1px solid #f0e0a8', borderRadius: 12, overflow: 'hidden' }}>
              {pendingItems.map((p) => {
                const pl = (() => { try { return JSON.parse(p.payload) as { demandeurNom?: string; dossierNumero?: string; dateDescente?: string }; } catch { return {}; } })();
                return (
                  <IonItem key={p.idLocal} lines="inset" style={{ '--background': '#fffbeb' }}>
                    <IonIcon icon={cloudOfflineOutline} slot="start" style={{ color: '#b7791f', fontSize: 20 }} />
                    <IonLabel>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <b style={{ fontSize: 13 }}>Descente locale</b>
                        <IonBadge style={{ background: '#b7791f', color: '#fff', fontSize: 9.5 }}>En attente</IonBadge>
                      </div>
                      <p style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                        {pl.demandeurNom || '(sans demandeur)'}{pl.dossierNumero ? ` · ${pl.dossierNumero}` : ''}
                      </p>
                      <p style={{ fontSize: 11, color: '#9ca3af' }}>
                        {formaterDate(pl.dateDescente)} · enregistré le {formaterDate(p.createdAt)}
                      </p>
                    </IonLabel>
                  </IonItem>
                );
              })}
            </IonList>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 50 }}>
            <IonSpinner name="crescent" />
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 50, color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
            <p>Aucune descente terrain{!online ? ' (hors-ligne)' : ''}</p>
          </div>
        ) : (
          <>
            <IonList>
              {items.map((d) => (
                <IonItem
                  key={d.idDescente}
                  button
                  onClick={() => history.push(`/tab/descente-terrain/${d.idDescente}`)}
                >
                  <IonLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <b style={{ fontSize: 14 }}>{d.reference || '—'}</b>
                      <IonBadge
                        style={{ background: couleurStatut(d.statutConstat), color: '#fff', fontSize: 9.5 }}
                      >
                        {d.statutConstat}
                      </IonBadge>
                      <IonBadge
                        style={{ background: couleurValidation(d.validation), color: '#fff', fontSize: 9.5 }}
                      >
                        {d.validation}
                      </IonBadge>
                    </div>
                    <p style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                      {d.nomPersonne || d.demandeurNom || '—'}{(d.numeroDossier || d.dossierNumero) ? ` · ${d.numeroDossier || d.dossierNumero}` : ''}
                    </p>
                    <p style={{ fontSize: 11, color: '#9ca3af' }}>
                      {formaterDate(d.dateDescente)} · {d.mode === 'offline' ? '📴 Hors ligne' : '🌐 En ligne'}
                    </p>
                  </IonLabel>
                  <span style={{ color: '#cbd5e1', fontSize: 18 }}>›</span>
                </IonItem>
              ))}
            </IonList>

            {page && page.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 14 }}>
                <IonButton
                  size="small" fill="outline"
                  disabled={page.first || currentPage === 0}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  ← Préc.
                </IonButton>
                <span style={{ alignSelf: 'center', fontSize: 12, color: '#6b7280' }}>
                  {currentPage + 1}/{page.totalPages}
                </span>
                <IonButton
                  size="small" fill="outline"
                  disabled={page.last}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Suiv. →
                </IonButton>
              </div>
            )}
          </>
        )}

        <IonFab vertical="bottom" horizontal="end" slot="fixed">
          <IonFabButton onClick={() => history.push('/tab/descente-terrain/nouveau')} style={{ '--background': '#176b87' }}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      </IonContent>

      <IonToast
        isOpen={!!toast}
        message={toast}
        duration={2500}
        color={toastColor}
        onDidDismiss={() => setToast('')}
      />
    </IonPage>
  );
}
