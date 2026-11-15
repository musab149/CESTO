import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, HelpCircle } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Public FAQ.
 *
 * Two rules here, both learned the hard way:
 *
 * 1. Nothing is asserted that the app does not do. The previous version
 *    promised delivery "within 60 minutes in central Madrid", a slot picker
 *    at checkout that has never existed, and instant refunds that contradict
 *    the Terms. A public page that overpromises is worse than no page.
 * 2. No delivery price is stated here at all. Since 2026-10-23 our team sets
 *    the fee on each order after it arrives and tells the customer, so a figure
 *    from the store settings would describe a charge nobody is making.
 */

type Faq = { q: string; a: React.ReactNode };

function useFaqs(): Faq[] {
  const { lang } = useLanguageStore();
  const es = lang === 'es';

  const deliveryCost = es
    ? 'No lo pagas al confirmar. Nuestro equipo añade el envío a tu pedido cuando lo revisa y te avisamos. Lo ves en el pedido y lo pagas al recibirlo.'
    : "You don't pay it when you confirm. Our team adds delivery to your order once they have seen it, and we let you know. You see it on the order and pay it on arrival.";

  return es
    ? [
        { q: '¿Cuánto tarda la entrega?',
          a: 'Repartimos dentro de nuestras zonas de servicio en España. Los tiempos que ves en la app son estimaciones, no garantías: dependen de tu zona y de la hora a la que pidas. Introduce tu código postal y te diremos si llegamos hasta ti.' },
        { q: '¿Cuánto cuesta el envío?', a: deliveryCost },
        { q: '¿Cómo sigo mi pedido?',
          a: 'Cada pedido tiene un estado: pendiente, confirmado, en preparación, en camino y entregado. Ábrelo en «Mis pedidos» para verlo. Cuando el repartidor tiene tu pedido, verás también su nombre y su teléfono.' },
        { q: '¿Puedo cambiar o cancelar un pedido?',
          a: 'Puedes cancelarlo desde la app mientras esté pendiente o confirmado. Una vez que está en preparación, escríbenos y haremos lo posible por ayudarte.' },
        { q: '¿Cómo puedo pagar?',
          a: 'Al recibir el pedido: en efectivo o con tarjeta (el repartidor lleva datáfono). No se introduce ningún dato bancario en la app.' },
        { q: '¿Qué pasa si un producto está agotado?',
          a: 'Verás que está agotado antes de añadirlo al carrito, y de nuevo al finalizar la compra si se ha agotado mientras tanto. Nunca sustituimos un producto por otro sin decírtelo, y no pagas lo que no te llega.' },
        { q: 'Mi pedido ha llegado mal, ¿qué hago?',
          a: 'Revísalo al recibirlo: puedes rechazar cualquier producto dañado, caducado o que no hayas pedido, y no lo pagas. Si te das cuenta después, escríbenos dentro de las 48 horas siguientes y te lo devolvemos o te lo reponemos.' },
        { q: '¿Puedo pedir de varias tiendas a la vez?',
          a: 'Sí. Si tu cesta mezcla productos de varias tiendas, te lo decimos antes de confirmar: cada tienda prepara y entrega su parte, así que el pedido puede llegar en más de una entrega.' },
        { q: '¿Cómo elimino mi cuenta?',
          a: (
            <>
              Desde Perfil → Editar perfil → «Eliminar mi cuenta». Si tienes un pedido en curso, podrás eliminarla cuando se haya entregado o cancelado.{' '}
              <Link to="/delete-account" className="text-brand font-semibold hover:underline">Aquí explicamos qué borramos y qué conservamos</Link>.
            </>
          ) },
      ]
    : [
        { q: 'How long does delivery take?',
          a: 'We deliver within our published service areas in Spain. The times shown in the app are estimates, not guarantees — they depend on your area and when you order. Enter your postcode and we will tell you whether we reach you.' },
        { q: 'How much is delivery?', a: deliveryCost },
        { q: 'How do I follow my order?',
          a: 'Every order has a status: pending, confirmed, preparing, on the way, and delivered. Open it under "My orders" to see it. Once a rider has your order, you will also see their name and phone number.' },
        { q: 'Can I change or cancel an order?',
          a: 'You can cancel it in the app while it is still pending or confirmed. Once it is being prepared, contact us and we will do what we can.' },
        { q: 'How can I pay?',
          a: 'When your order arrives: cash or card (the rider carries a card reader). No bank details are ever entered in the app.' },
        { q: 'What if a product is out of stock?',
          a: 'You will see it marked out of stock before adding it to your cart, and again at checkout if it sold out in between. We never substitute one product for another without telling you, and you never pay for something that does not arrive.' },
        { q: 'Something arrived damaged or wrong. What now?',
          a: 'Check your order on arrival: you can refuse anything damaged, out of date or that you did not order, and you will not pay for it. If you notice later, contact us within 48 hours and we will refund or replace it.' },
        { q: 'Can I order from more than one shop at once?',
          a: 'Yes. If your basket mixes items from several shops, we tell you before you confirm: each shop prepares and delivers its own part, so an order can arrive in more than one delivery.' },
        { q: 'How do I delete my account?',
          a: (
            <>
              Profile → Edit profile → "Delete my account". If you have an order in progress, you can delete it once that order has been delivered or cancelled.{' '}
              <Link to="/delete-account" className="text-brand font-semibold hover:underline">We explain what is deleted and what is kept here</Link>.
            </>
          ) },
      ];
}

export default function FaqPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguageStore();
  const faqs = useFaqs();
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const es = lang === 'es';

  return (
    <div className="max-w-[800px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm font-semibold font-display text-muted hover:text-brand transition-colors mb-6"
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        {es ? 'Volver' : 'Back'}
      </button>

      <div className="flex items-center gap-3 mb-2">
        <HelpCircle size={28} className="text-brand shrink-0" strokeWidth={1.75} />
        <h1 className="text-3xl font-extrabold text-ink font-display">{t('profile.faq')}</h1>
      </div>
      <p className="text-sm text-gray font-body mb-8">
        {es ? '¿No encuentras lo que buscas? ' : "Can't find what you need? "}
        <button onClick={() => navigate('/contact')} className="text-brand font-bold hover:underline">
          {es ? 'Escríbenos' : 'Contact support'}
        </button>.
      </p>

      <div className="flex flex-col gap-3">
        {faqs.map((item, i) => {
          const open = openIdx === i;
          return (
            <div key={item.q} className="bg-surface-cream border border-border/60 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenIdx(open ? null : i)}
                className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-surface-linen transition-colors"
              >
                <span className="text-base font-bold text-ink font-display">{item.q}</span>
                <ChevronDown
                  size={18}
                  strokeWidth={2}
                  className={`text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
              {open && (
                <div className="px-5 pb-5 text-sm text-charcoal font-body leading-relaxed">
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
