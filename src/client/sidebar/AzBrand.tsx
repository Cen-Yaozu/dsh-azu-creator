import { AZU_ICON_SRC } from "../assets/azuIcon.ts";

export interface AzBrandProps {
  compact?: boolean;
  name?: string;
  tagline?: string;
}

export type MzBrandProps = AzBrandProps;

/** Render the Azu Creator identity inside plugin-owned sidebar chrome. */
export function AzBrand({ compact = false, name = "Azu 工作台", tagline }: AzBrandProps) {
  return (
    <span className="mzBrand">
      <img className="mzBrandIcon" src={AZU_ICON_SRC} alt="" aria-hidden="true" />
      {!compact && (
        <span className="mzBrandCopy">
          <span className="mzBrandText">{name}</span>
          {tagline !== undefined && <span className="mzBrandTagline">{tagline}</span>}
        </span>
      )}
    </span>
  );
}

export const MzBrand = AzBrand;

