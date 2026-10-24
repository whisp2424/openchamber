import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { reportSettingsSaveState } from '@/lib/persistence';
import { getRuntimeKey, subscribeRuntimeEndpointWillChange } from '@/lib/runtime-switch';
import { BackgroundImageError, prepareBackgroundImage } from './image';
import { chatBackground, useChatBackground } from './useChatBackground';
import './background.css';

function BackgroundPreview({
  imageUrl,
  chooseLabel,
  disabled,
  onChoose,
}: {
  imageUrl: string | null;
  chooseLabel: string;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className="oc-background-preview relative block h-auto aspect-video w-full max-w-xs overflow-hidden rounded-xl border border-border bg-background p-0 text-start hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={chooseLabel}
      disabled={disabled}
      onClick={onChoose}
    >
      {imageUrl ? <img aria-hidden="true" alt="" className="absolute inset-0 size-full object-cover opacity-85" src={imageUrl} /> : null}
      <span aria-hidden="true" className="oc-background-preview-scrim" />
    </Button>
  );
}

export function BackgroundSettings() {
  const { t } = useI18n();
  const state = useChatBackground();
  const picker = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState<'invalid' | 'size' | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeRuntimeEndpointWillChange(() => {
      selection.current += 1;
      setPreparing(false);
      setImageError(null);
    });
    return () => { selection.current += 1; unsubscribe(); };
  }, []);
  useEffect(() => {
    reportSettingsSaveState(state.saving || preparing ? 'saving' : state.error === 'save' ? 'error' : 'saved');
  }, [preparing, state.saving, state.error]);

  const choose = async (file: File) => {
    const request = ++selection.current;
    const owner = getRuntimeKey();
    setPreparing(true);
    setImageError(null);
    try {
      const image = await prepareBackgroundImage(file);
      if (selection.current === request && owner === getRuntimeKey()) await chatBackground.upload(image);
    } catch (error) {
      if (selection.current === request && owner === getRuntimeKey()) {
        setImageError(error instanceof BackgroundImageError ? error.reason : 'invalid');
      }
    } finally {
      if (selection.current === request && owner === getRuntimeKey()) setPreparing(false);
    }
  };
  const errorText = imageError === 'size' ? t('settings.chatBackground.sizeError')
    : imageError === 'invalid' ? t('settings.chatBackground.invalidError')
      : state.error === 'save' ? t('settings.chatBackground.saveError')
        : state.error === 'load' ? t('settings.chatBackground.loadError') : '';
  const disabled = preparing || state.saving || !state.configuration;

  return (
    <SettingsSection title={t('settings.chatBackground.title')} description={t('settings.chatBackground.description')}>
      <div className="space-y-3">
        <BackgroundPreview
          imageUrl={state.imageUrl}
          chooseLabel={t('settings.chatBackground.choose')}
          disabled={disabled}
          onChoose={() => picker.current?.click()}
        />
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label={t('settings.chatBackground.choose')}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void choose(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2" data-settings-item="appearance.background-image">
          <Button variant="outline" disabled={disabled} onClick={() => picker.current?.click()}>
            {t('settings.chatBackground.choose')}
          </Button>
          <Button variant="ghost" disabled={disabled || !state.configuration?.imageId} onClick={() => {
            setImageError(null);
            void chatBackground.remove();
          }}>
            {t('settings.chatBackground.remove')}
          </Button>
        </div>
      </div>
      <p role="status" className="typography-meta mt-3 min-h-5 truncate text-[var(--status-error-text)]" title={errorText}>
        {errorText}
      </p>
    </SettingsSection>
  );
}
