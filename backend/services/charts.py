"""
Charts for documents — rendered server-side to PNG in the design system.

Gerry had no way to draw an axis chart: Word/Doc tools wrote text and tables,
Sheets had no chart option, and there was no image generation, so a "chart"
came out as rows of block characters. This module turns a small JSON spec
into a real PNG (matplotlib, Agg backend, brand fonts and palette) that
``create_docx`` embeds inline and ``create_chart`` saves on its own.

Spec (the agent writes this; ``validate_spec`` reports what is wrong):

    {"type": "bar"|"line"|"column"|"stacked_bar"|"pie"|"scatter",
     "title": str, "subtitle"?: str,
     "categories": [str, ...],                 # x labels (bar/column/line/stacked)
     "series": [{"name": str, "values": [num, ...]}, ...],
     "x_label"?: str, "y_label"?: str, "unit"?: str ("$", "%", "h", …),
     "y_min"?: num, "y_max"?: num, "show_values"?: bool, "source"?: str}

``scatter`` uses ``series[].points: [[x, y], ...]`` instead of categories.
"""
from __future__ import annotations

import contextlib
import io
from pathlib import Path
from typing import Any

CHART_TYPES = ("bar", "column", "line", "stacked_bar", "pie", "scatter")
MAX_SERIES = 8
MAX_POINTS = 60

# Palette: black first, red accent second, then greys — the design system's
# black/white with one red, so a chart beside brand text does not look foreign.
_SERIES_COLOURS = ("000000", "FF0000", "6F6F6F", "9B9B9B", "C4C4C4", "333333", "E0E0E0", "7A0000")


def validate_spec(spec: Any) -> dict:
    """Normalise a chart spec; raise ``ValueError`` with an actionable message."""
    if not isinstance(spec, dict):
        raise ValueError("chart spec must be an object")
    ctype = str(spec.get("type") or "bar").strip().lower()
    if ctype not in CHART_TYPES:
        raise ValueError(f"chart type '{ctype}' is not one of {', '.join(CHART_TYPES)}")
    series = spec.get("series")
    if not isinstance(series, list) or not series:
        raise ValueError("chart needs 'series': a list of {name, values}")
    if len(series) > MAX_SERIES:
        raise ValueError(f"at most {MAX_SERIES} series per chart")
    out: dict[str, Any] = {
        "type": ctype,
        "title": str(spec.get("title") or "").strip(),
        "subtitle": str(spec.get("subtitle") or "").strip(),
        "x_label": str(spec.get("x_label") or "").strip(),
        "y_label": str(spec.get("y_label") or "").strip(),
        "unit": str(spec.get("unit") or "").strip(),
        "source": str(spec.get("source") or "").strip(),
        "show_values": bool(spec.get("show_values", ctype in ("bar", "column", "pie"))),
        "y_min": _num_or_none(spec.get("y_min")),
        "y_max": _num_or_none(spec.get("y_max")),
        "series": [],
    }
    if ctype == "scatter":
        for i, s in enumerate(series):
            pts = s.get("points") if isinstance(s, dict) else None
            if not isinstance(pts, list) or not pts:
                raise ValueError(f"series {i + 1} needs 'points': [[x, y], ...] for a scatter chart")
            clean = []
            for p in pts[:MAX_POINTS]:
                if not (isinstance(p, (list, tuple)) and len(p) == 2):
                    raise ValueError(f"series {i + 1}: every point must be [x, y]")
                clean.append((_num(p[0], f"series {i + 1} x"), _num(p[1], f"series {i + 1} y")))
            out["series"].append({"name": str(s.get("name") or f"Series {i + 1}"), "points": clean})
        return out

    cats = spec.get("categories")
    if not isinstance(cats, list) or not cats:
        raise ValueError("chart needs 'categories': the x-axis labels (one per value)")
    cats = [str(c) for c in cats[:MAX_POINTS]]
    if ctype == "pie" and len(series) != 1:
        raise ValueError("a pie chart takes exactly one series")
    for i, s in enumerate(series):
        if not isinstance(s, dict):
            raise ValueError(f"series {i + 1} must be an object {{name, values}}")
        vals = s.get("values")
        if not isinstance(vals, list):
            raise ValueError(f"series {i + 1} needs 'values'")
        vals = vals[:MAX_POINTS]
        if len(vals) != len(cats):
            raise ValueError(
                f"series {i + 1} ('{s.get('name', '')}') has {len(vals)} values but there are {len(cats)} categories"
            )
        out["series"].append({
            "name": str(s.get("name") or f"Series {i + 1}"),
            "values": [None if v is None else _num(v, f"series {i + 1} value") for v in vals],
        })
    if ctype == "pie" and any((v or 0) < 0 for v in out["series"][0]["values"]):
        raise ValueError("pie slices cannot be negative")
    out["categories"] = cats
    return out


def _num(v: Any, what: str) -> float:
    try:
        return float(str(v).replace(",", "").replace("$", "").replace("%", "").strip())
    except (TypeError, ValueError):
        raise ValueError(f"{what} '{v}' is not a number") from None


def _num_or_none(v: Any) -> float | None:
    return None if v in (None, "") else _num(v, "axis limit")


def _fmt(v: float, unit: str) -> str:
    if abs(v) >= 1000 and float(v).is_integer():
        s = f"{int(v):,}"
    elif float(v).is_integer():
        s = str(int(v))
    else:
        s = f"{v:,.1f}".rstrip("0").rstrip(".")
    if unit == "$":
        return f"${s}"
    if unit == "%":
        return f"{s}%"
    return f"{s}{(' ' + unit) if unit else ''}"


def render_png(spec: dict, width_in: float = 6.5, height_in: float = 3.6, dpi: int = 200) -> bytes:
    """Render a validated spec to PNG bytes in the design system."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    from matplotlib.ticker import FuncFormatter

    from services import design_system as ds
    from services import design_tokens as dt

    t = ds.tokens()
    display, mono = _register_fonts(font_manager, dt, t)
    hx = lambda h: "#" + h  # noqa: E731
    colours = [hx(c) for c in _SERIES_COLOURS]
    # Replace the second colour with the brand accent if it differs from pure red.
    colours[1] = hx(t.red)

    plt.rcParams.update({
        "font.family": display,
        "axes.edgecolor": hx(t.hairline),
        "axes.labelcolor": hx(t.ink_300),
        "xtick.color": hx(t.ink_500),
        "ytick.color": hx(t.ink_500),
        "text.color": hx(t.ink_500),
        "axes.titlelocation": "left",
        "svg.fonttype": "none",
    })

    fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=dpi)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    ctype = spec["type"]
    series = spec["series"]
    unit = spec["unit"]
    n_series = len(series)

    if ctype == "pie":
        vals = [v or 0 for v in series[0]["values"]]
        total = sum(vals) or 1
        wedges, _ = ax.pie(
            vals, colors=colours[: len(vals)], startangle=90, counterclock=False,
            wedgeprops={"linewidth": 1.5, "edgecolor": "white"},
        )
        labels = [f"{c}  {_fmt(v, unit)} ({v / total:.0%})" for c, v in zip(spec["categories"], vals, strict=True)]
        ax.legend(wedges, labels, loc="center left", bbox_to_anchor=(1.0, 0.5), frameon=False,
                  prop={"family": mono, "size": 7.5})
        ax.set_aspect("equal")
    elif ctype == "scatter":
        for i, s in enumerate(series):
            xs, ys = zip(*s["points"], strict=True)
            ax.scatter(xs, ys, s=22, color=colours[i % len(colours)], label=s["name"], zorder=3)
    elif ctype == "line":
        x = range(len(spec["categories"]))
        for i, s in enumerate(series):
            ax.plot(list(x), s["values"], color=colours[i % len(colours)], linewidth=2.0,
                    marker="o", markersize=3.5, label=s["name"], zorder=3)
        ax.set_xticks(list(x), spec["categories"])
    else:  # bar / column / stacked_bar
        horizontal = ctype == "bar"
        idx = list(range(len(spec["categories"])))
        if ctype == "stacked_bar":
            bottoms = [0.0] * len(idx)
            for i, s in enumerate(series):
                vals = [v or 0 for v in s["values"]]
                if horizontal:
                    ax.barh(idx, vals, left=bottoms, color=colours[i % len(colours)], label=s["name"], height=0.62, zorder=3)
                else:
                    ax.bar(idx, vals, bottom=bottoms, color=colours[i % len(colours)], label=s["name"], width=0.62, zorder=3)
                bottoms = [b + v for b, v in zip(bottoms, vals, strict=True)]
            if spec["show_values"]:
                for k, total in enumerate(bottoms):
                    _annotate(ax, k, total, _fmt(total, unit), horizontal, mono, hx(t.ink_500))
        else:
            group_w = 0.72
            bar_w = group_w / n_series
            for i, s in enumerate(series):
                offs = [k - group_w / 2 + bar_w * (i + 0.5) for k in idx]
                vals = [v or 0 for v in s["values"]]
                if horizontal:
                    ax.barh(offs, vals, height=bar_w * 0.9, color=colours[i % len(colours)], label=s["name"], zorder=3)
                else:
                    ax.bar(offs, vals, width=bar_w * 0.9, color=colours[i % len(colours)], label=s["name"], zorder=3)
                if spec["show_values"]:
                    for o, v in zip(offs, vals, strict=True):
                        _annotate(ax, o, v, _fmt(v, unit), horizontal, mono, hx(t.ink_500), small=n_series > 2)
        if horizontal:
            ax.set_yticks(idx, spec["categories"])
            ax.invert_yaxis()
        else:
            ax.set_xticks(idx, spec["categories"])

    if ctype != "pie":
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        ax.spines["left"].set_visible(ctype == "scatter")
        ax.grid(axis="x" if ctype == "bar" else "y", color=hx(t.hairline), linewidth=0.8, zorder=0)
        ax.set_axisbelow(True)
        ax.tick_params(length=0, labelsize=8)
        for lbl in ax.get_xticklabels() + ax.get_yticklabels():
            lbl.set_fontfamily(mono)
        value_axis = ax.xaxis if ctype == "bar" else ax.yaxis
        value_axis.set_major_formatter(FuncFormatter(lambda v, _p: _fmt(v, unit)))
        lo, hi = spec["y_min"], spec["y_max"]
        if lo is not None or hi is not None:
            (ax.set_xlim if ctype == "bar" else ax.set_ylim)(lo, hi)
        if spec["x_label"]:
            ax.set_xlabel(spec["x_label"], fontsize=8, fontfamily=mono, labelpad=6)
        if spec["y_label"]:
            ax.set_ylabel(spec["y_label"], fontsize=8, fontfamily=mono, labelpad=6)
        if n_series > 1 or ctype == "scatter":
            ax.legend(loc="upper left", bbox_to_anchor=(0, -0.14 - (0.06 if spec["x_label"] else 0)),
                      ncol=min(n_series, 4), frameon=False, prop={"family": mono, "size": 7.5},
                      handlelength=1.2, columnspacing=1.4)
        # Many or long category labels: tilt them (short labels stay level).
        if ctype != "bar" and spec.get("categories") and (
            len(spec["categories"]) > 12 or max(len(c) for c in spec["categories"]) > 12
        ):
            plt.setp(ax.get_xticklabels(), rotation=30, ha="right")

    if spec["title"]:
        fig.text(0.0, 1.0, spec["title"], ha="left", va="top", fontsize=12, fontweight="bold",
                 fontfamily=display, color=hx(t.black), transform=fig.transFigure)
        # Red title rule, like the document title; the subtitle sits under it.
        fig.add_artist(plt.Line2D([0.0, 0.08], [0.905, 0.905], color=hx(t.red), linewidth=1.5,
                                  transform=fig.transFigure))
    if spec["subtitle"]:
        fig.text(0.0, 0.885 if spec["title"] else 1.0, spec["subtitle"], ha="left", va="top",
                 fontsize=8, fontfamily=mono, color=hx(t.ink_300), transform=fig.transFigure)
    if spec["source"]:
        fig.text(0.0, 0.0, f"SOURCE  {spec['source']}".upper(), ha="left", va="bottom", fontsize=6.5,
                 fontfamily=mono, color=hx(t.ink_200), transform=fig.transFigure)

    top = (0.76 if spec["subtitle"] else 0.80) if spec["title"] else 0.95
    bottom = 0.22 if (n_series > 1 and ctype not in ("pie",)) else 0.16
    fig.subplots_adjust(left=(0.08 if not spec["y_label"] else 0.12) if ctype != "bar" else 0.22,
                        right=0.98 if ctype != "pie" else 0.55, top=top, bottom=bottom)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _annotate(ax, pos, value, text, horizontal, mono, colour, small=False):
    size = 6.5 if small else 7.5
    if horizontal:
        ax.annotate(text, (value, pos), xytext=(4, 0), textcoords="offset points", va="center",
                    ha="left", fontsize=size, fontfamily=mono, color=colour)
    else:
        ax.annotate(text, (pos, value), xytext=(0, 3), textcoords="offset points", ha="center",
                    va="bottom", fontsize=size, fontfamily=mono, color=colour)


def _register_fonts(font_manager, dt, t) -> tuple[str, str]:
    """Register the brand TTFs with matplotlib; fall back to DejaVu if missing."""
    out = []
    for family in (t.font_display, t.font_mono):
        files = dt.font_files(family)
        if files:
            for p in files.values():
                with contextlib.suppress(Exception):  # a bad font file just means fallback
                    font_manager.fontManager.addfont(str(p))
            out.append(family)
        else:
            out.append("DejaVu Sans" if family == t.font_display else "DejaVu Sans Mono")
    return out[0], out[1]


def render_to_file(spec: dict, path: Path, **kw) -> int:
    data = render_png(spec, **kw)
    path.write_bytes(data)
    return len(data)
