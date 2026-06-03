import { useState } from 'react';
import { Layers, Plus, FileUp, ChevronLeft, ChevronRight } from 'lucide-react';

const SLIDES = [
  {
    Icon: Layers,
    title: 'Bienvenido a tu portafolio',
    description:
      'Acá podés hacer seguimiento de todas tus inversiones: acciones, fondos mutuos, crypto y más. ' +
      'El sistema calcula el valor actualizado de cada posición con precios del mercado.',
  },
  {
    Icon: Plus,
    title: 'Agregá tu primera inversión',
    description:
      'Tocá "+ Nueva" para registrar una posición. Podés ingresar en cuotas/unidades, monto en CLP o USD. ' +
      'Desde el mismo botón también podés registrar aportes y retiros a instrumentos existentes.',
  },
  {
    Icon: FileUp,
    title: 'Subí tu cartola con IA',
    description:
      'Si tenés un estado de cuenta en PDF o imagen, la IA lo analiza automáticamente y te propone ' +
      'las posiciones a agregar. Vos revisás, editás si hace falta, y confirmás con un click.',
  },
];

export default function TutorialCarousel({ onDismiss }) {
  const [idx, setIdx] = useState(0);
  const isLast = idx === SLIDES.length - 1;
  const { Icon, title, description } = SLIDES[idx];

  return (
    <div className="card p-6 space-y-6">
      {/* Slides */}
      <div className="text-center space-y-4 min-h-[140px] flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-accent/15 flex items-center justify-center mx-auto">
          <Icon size={22} className="text-accent" />
        </div>
        <div>
          <h3 className="font-semibold text-base">{title}</h3>
          <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">{description}</p>
        </div>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-2">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === idx ? 'bg-accent w-5' : 'bg-bg-border hover:bg-muted'
            }`}
          />
        ))}
      </div>

      {/* Controles */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIdx(i => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="p-2 rounded-lg text-muted hover:bg-bg-hover disabled:opacity-0 transition-opacity">
          <ChevronLeft size={18} />
        </button>

        <button onClick={onDismiss} className="text-xs text-muted hover:text-gray-300">
          Saltar tutorial
        </button>

        {isLast ? (
          <button
            onClick={onDismiss}
            className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent/90 text-white font-medium">
            Empezar
          </button>
        ) : (
          <button
            onClick={() => setIdx(i => i + 1)}
            className="p-2 rounded-lg text-muted hover:bg-bg-hover">
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
