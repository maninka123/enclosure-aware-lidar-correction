# Geometry and correction equations

This implementation follows the vector formulation in the project's `dome_beam_refraction.py`. The original MATLAB model uses the same two Snell interfaces with angle/slope calculations. The 3D extension computes one physical ray, avoiding separate XZ/YZ sign decisions.

Let the interior source be O, dome center C, inner radius R, wall thickness h, and unit incident direction d. For an interior point, the forward exit of a sphere is

```text
q = O - C
t = -dot(q,d) + sqrt(dot(q,d)^2 + radius^2 - dot(q,q))
P = O + t*d
N = (P-C)/radius
```

At each interface N points from the current medium into the next medium. Vector Snell refraction is

```text
tangent = (n1/n2) * (d - dot(d,N)*N)
d_next = tangent + sqrt(1-dot(tangent,tangent))*N
```

A squared tangential magnitude above one means total internal reflection. Intersect R, refract from inside to wall, intersect R+h, then refract from wall to outside. Both surfaces are concentric; the source must be inside the inner sphere. The aperture check applies to both hits. A shell rim or base plate is not modeled.

For raw sensor point p, `r=norm(p)` and `d_sensor=p/r`. With rotation Q from sensor to enclosure, `d=Q*d_sensor`. The ray source O is supplied in enclosure coordinates. The full endpoint in enclosure coordinates is

```text
P_corrected = P_outer + L_outside * d_exit
p_corrected_sensor = Q.T * (P_corrected - O)
```

The remaining range is `r-L_inside-L_wall` for total geometric path ranges. For optical ranges it is

```text
L_outside = (n_reference*r - n_inside*L_inside - n_wall*L_wall) / n_outside
```

For reciprocal monostatic time-of-flight, the factor of two is already removed by the sensor's range conversion. Do not divide a reported range by two again. The simplified optical model uses the configured indices for both refraction and propagation delay; wavelength, group/phase-index differences, firmware compensation and instrument offsets require further characterization before real-data accuracy claims.

Direction-only mode returns `Q.T*(r*d_exit)` instead. It approximates the exit ray as originating at the LiDAR source. Independent 2D projected corrections are generally not equivalent to full 3D tracing when the source and ray are outside the chosen plane.

The browser exposes all three range interpretations in Point Clouds and Scene Lab. **Direction only (paper-style LUT)** preserves the measured radius, **geometric path** treats that radius as physical path length, and **optical path (recommended for ToF)** treats it as a range derived from propagation time. Optical path is a starting recommendation rather than a universal choice: the selected model must match the sensor firmware's range convention and the available calibration.

The angular LUT uses that direction-only analytical result as its reference. In the sensor frame,

```text
theta_xz = atan2(d_z, d_x)
theta_yz = atan2(d_z, d_y)
```

Each plane angle spans 0°–180°: 0° is the positive lateral axis, 90° is sensor +Z, and 180° is the negative lateral axis. The two angles preserve quadrants and are converted back to one normalized 3D direction. At runtime the four neighbouring exit vectors are bilinearly weighted and normalized. The corrected LUT point is `r*d_lut`, so its radius equals the sensor measurement. Comparing this with analytical `direction_only` measures interpolation error; comparing it with geometric- or optical-path reconstruction measures a difference between range assumptions.

Sensitivity endpoints are 5 m beyond each outer hit, matching the existing script. They are not intersections with a common target plane. The normalized 1 m metric uses baseline endpoint pairs 0.9–1.1 m apart and scales length changes to 1 m; it is not an exact simulated ruler. The synthetic plane experiment separately constructs intersections with the enclosure plane z=5 m and simulates optical ranges.

The signed angle sweep measures the change of direction projected onto XZ. For an off-plane source, this differs from the full 3D angular deviation; both values are exported separately. Sensitivity variations that make the geometry invalid are recorded with zero valid rays and an explanation in the detail table, rather than stopping the run.
