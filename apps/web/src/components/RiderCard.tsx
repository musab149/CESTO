import { Bike, Car, MessageCircle, Phone, Truck } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

interface RiderCardProps {
  rider: { id?: string; name: string; phone: string; vehicle_type: string };
  delivered: boolean;
}

/**
 * Who is bringing an order, with a call and a WhatsApp button while it is on
 * its way. Shared by the order page and the Home Grocery plan.
 */
export default function RiderCard({ rider, delivered }: RiderCardProps) {
  const { t, lang } = useLanguageStore();
  const VehicleIcon = rider.vehicle_type === 'bicicleta' ? Bike : rider.vehicle_type === 'coche' ? Car : Truck;
  const vehicleLabel =
    rider.vehicle_type === 'bicicleta' ? (lang === 'en' ? 'Bicycle' : 'Bicicleta')
    : rider.vehicle_type === 'coche' ? (lang === 'en' ? 'Car' : 'Coche')
    : (lang === 'en' ? 'Motorbike' : 'Moto');
  const initials = rider.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const waPhone = rider.phone.replace(/[^\d]/g, '');

  return (
    <div className="bg-surface-white border border-border/60 rounded-lg p-6">
      <div className="flex items-center gap-2 mb-4">
        <Truck size={16} className="text-brand" />
        <h3 className="text-sm font-bold text-ink font-display">
          {delivered ? t('order.delivered_by') : t('order.your_rider')}
        </h3>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold font-display text-base shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink font-display leading-tight truncate">{rider.name}</p>
          <p className="text-xs text-muted font-body mt-0.5 flex items-center gap-1.5">
            <VehicleIcon size={12} strokeWidth={1.75} />
            {vehicleLabel}
          </p>
        </div>
      </div>

      {!delivered && (
        <div className="grid grid-cols-2 gap-2">
          <a
            href={`tel:${rider.phone}`}
            className="h-10 rounded-lg bg-brand text-white text-xs font-bold font-display inline-flex items-center justify-center gap-1.5 hover:bg-brand-mid transition-colors"
          >
            <Phone size={14} strokeWidth={2} />
            {t('order.call_rider')}
          </a>
          <a
            href={`https://wa.me/${waPhone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="h-10 rounded-lg border border-border bg-surface-cream text-ink text-xs font-bold font-display inline-flex items-center justify-center gap-1.5 hover:bg-surface-linen transition-colors"
          >
            <MessageCircle size={14} strokeWidth={2} className="text-success" />
            WhatsApp
          </a>
        </div>
      )}
      {delivered && (
        <p className="text-xs font-mono text-muted">{rider.phone}</p>
      )}
    </div>
  );
}
