"""RTSP kadr manbai.

Ikkita muhim xatti-harakat:

1. Kadr tashlash. Kamera 25 fps beradi, biz 6 fps tahlil qilamiz. Agar
   navbatga yig'ilsa, tizim real vaqtdan orqada qoladi va "yong'in" haqidagi
   signal 2 daqiqa kechikib keladi. Shuning uchun har doim ENG YANGI kadr
   olinadi, eskilari tashlanadi.

2. Qayta ulanish. CCTV tarmog'i beqaror: kamera qayta yuklanadi, switch
   uziladi. Manba o'zi qayta ulanishi va bu haqda xabar berishi kerak.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable, Iterator

import av
import numpy as np

log = logging.getLogger(__name__)

# Bir xil kadr ketma-ket kelganda oqim "muzlagan" deb hisoblanadi.
STALE_FRAME_LIMIT = 45


def _frame_fingerprint(image: np.ndarray) -> int:
    """Tez taqqoslash: kichik grayscale o'rtacha."""
    small = image[::16, ::16, 0]
    return int(small.mean() * 1000) + small.size


@dataclass(slots=True)
class Frame:
    image: np.ndarray  # BGR, OpenCV konvensiyasi
    timestamp: float  # monotonik, soniya
    wall_time: float  # unix epoch, event vaqti uchun
    index: int


class RtspSource:
    def __init__(
        self,
        url: str,
        target_fps: float,
        *,
        redacted_url: str = "rtsp://***",
        reconnect_base_delay: float = 2.0,
        reconnect_max_delay: float = 60.0,
        on_state_change: Callable[[bool, str | None], None] | None = None,
    ) -> None:
        self._url = url
        self._redacted = redacted_url
        self._min_interval = 1.0 / max(target_fps, 0.1)
        self._reconnect_base = reconnect_base_delay
        self._reconnect_max = reconnect_max_delay
        self._on_state_change = on_state_change

        self._stop = threading.Event()
        self._connected = False
        self._frame_index = 0
        self._dropped = 0

    def stop(self) -> None:
        self._stop.set()

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def dropped_frames(self) -> int:
        return self._dropped

    def _set_state(self, connected: bool, reason: str | None = None) -> None:
        if connected == self._connected:
            return
        self._connected = connected
        if self._on_state_change:
            self._on_state_change(connected, reason)

    def frames(self) -> Iterator[Frame]:
        """Cheksiz kadr oqimi. stop() chaqirilmaguncha o'zi qayta ulanadi."""
        attempt = 0

        while not self._stop.is_set():
            try:
                yield from self._read_container()
                # Konteyner xatosiz tugadi: oqim yopilgan.
                attempt = 0
                self._set_state(False, "oqim yopildi")
            except Exception as exc:  # noqa: BLE001
                self._set_state(False, str(exc))
                log.warning("RTSP xatosi (%s): %s", self._redacted, exc)

            if self._stop.is_set():
                break

            delay = min(self._reconnect_base * (2**attempt), self._reconnect_max)
            attempt += 1
            log.info("Qayta ulanish %.0fs dan keyin: %s", delay, self._redacted)
            self._stop.wait(delay)

    def _read_container(self) -> Iterator[Frame]:
        # TCP: UDP da katta kadrlar bo'linib yo'qoladi va tasvir "buziladi".
        # stimeout mikrosoniyada - kamera javob bermasa osilib qolmaslik uchun.
        options = {
            "rtsp_transport": "tcp",
            "stimeout": "5000000",
            "max_delay": "500000",
            "reorder_queue_size": "0",
            "fflags": "nobuffer",
            "flags": "low_delay",
            "err_detect": "ignore_err",
        }

        container = av.open(self._url, options=options, timeout=(10.0, 5.0))
        try:
            stream = container.streams.video[0]
            # Dekoder ichki buferini minimallashtirish: bizga eng yangi kadr kerak.
            stream.thread_type = "AUTO"

            self._set_state(True)
            log.info("Ulandi: %s", self._redacted)

            last_emitted = 0.0
            last_fingerprint: int | None = None
            stale_frames = 0

            for packet in container.demux(stream):
                if self._stop.is_set():
                    return

                for av_frame in packet.decode():
                    now = time.monotonic()

                    # Kadr tashlash: belgilangan fps dan tez kelgan kadrlarni
                    # dekodlangan bo'lsa ham chiqarib yubormaymiz.
                    if now - last_emitted < self._min_interval:
                        self._dropped += 1
                        continue

                    image = av_frame.to_ndarray(format="bgr24")
                    fingerprint = _frame_fingerprint(image)
                    if fingerprint == last_fingerprint:
                        stale_frames += 1
                    else:
                        stale_frames = 0
                        last_fingerprint = fingerprint

                    if stale_frames >= STALE_FRAME_LIMIT:
                        log.warning(
                            "RTSP oqimi muzlab qoldi (%d bir xil kadr), qayta ulanilmoqda: %s",
                            stale_frames,
                            self._redacted,
                        )
                        return

                    last_emitted = now
                    self._frame_index += 1

                    yield Frame(
                        image=image,
                        timestamp=now,
                        wall_time=time.time(),
                        index=self._frame_index,
                    )
        finally:
            container.close()
