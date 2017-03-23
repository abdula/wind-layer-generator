#https://github.com/Unidata/MetPy/blob/master/examples/gridding/Point_Interpolation.py
#http://geoexamples.blogspot.com/2012/05/creating-grid-from-scattered-data-using.html
#http://geoexamples.blogspot.com.es/2012/03/creating-grid-from-scattered-data-using.html

import matplotlib
matplotlib.use('Agg')

import matplotlib.pyplot as plt
import numpy as np
import os
import os.path
from os.path import exists
from os import remove
from osgeo import ogr
from osgeo import gdal
from osgeo import osr
import json
import csv
import resource
from scipy.interpolate import griddata, Rbf
from scipy.spatial.distance import cdist
from argparse import ArgumentParser



#from metpy.gridding.gridding_functions import (interpolate)

def remove_nan_observations(x, y, z):
    x_ = x[~np.isnan(z)]
    y_ = y[~np.isnan(z)]
    z_ = z[~np.isnan(z)]

    return x_, y_, z_

def remove_repeat_coordinates(x, y, z):
    coords = []
    variable = []

    for (x_, y_, t_) in zip(x, y, z):
        if (x_, y_) not in coords:
            coords.append((x_, y_))
            variable.append(t_)

    coords = np.array(coords)

    x_ = coords[:, 0]
    y_ = coords[:, 1]

    z_ = np.array(variable)

    return x_, y_, z_


def get_xy_range(bbox):
    x_range = bbox['east'] - bbox['west']
    y_range = bbox['north'] - bbox['south']

    return x_range, y_range

def get_xy_steps(bbox, h_dim):
    x_range, y_range = get_xy_range(bbox)

    x_steps = np.ceil(x_range / h_dim)
    y_steps = np.ceil(y_range / h_dim)

    return int(x_steps), int(y_steps)

def generate_grid(horiz_dim, bbox):
    x_steps, y_steps = get_xy_steps(bbox, horiz_dim)

    grid_x = np.linspace(bbox['west'], bbox['east'], x_steps)
    grid_y = np.linspace(bbox['south'], bbox['north'], y_steps)

    gx, gy = np.meshgrid(grid_x, grid_y)

    return gx, gy

def get_boundary_coords(x, y, spatial_pad=0):
    west = np.min(x) - spatial_pad
    east = np.max(x) + spatial_pad
    north = np.max(y) + spatial_pad
    south = np.min(y) - spatial_pad

    return {'west': west, 'south': south, 'east': east, 'north': north}

def interpolate(x, y, z, hres=50000, interp_type="linear", rbf_func='linear', rbf_smooth=0, spatial_pad=0):
    grid_x, grid_y = generate_grid(hres, get_boundary_coords(x, y, spatial_pad=spatial_pad))

    if interp_type in ['linear', 'nearest', 'cubic']:
        points_zip = np.array(list(zip(x, y)))
        img = griddata(points_zip, z, (grid_x, grid_y), method=interp_type)

    elif interp_type == 'rbf':
        h = np.zeros((len(x)))
        rbfi = Rbf(x, y, h, z, function=rbf_func, smooth=rbf_smooth)

        hi = np.zeros(grid_x.shape)
        img = rbfi(grid_x, grid_y, hi)
    else:
         raise ValueError('Interpolation option not available. '
                         'Try: linear, nearest, cubic, rbf')
    return grid_x, grid_y, img

def read_data(file_path, value_field="wind"):
    maxX = -66.949895
    minX = -128.342102
    maxY = 49.384358
    minY = 18.917466


    x = np.array([], np.float32)
    y = np.array([], np.float32)
    z = np.array([], np.float32)

    with open(file_path) as data_file:
        data = csv.DictReader(data_file, delimiter=',')

        for entry in data:
            try:
                lon = float(entry["longitude"])
                lat = float(entry["latitude"])
                value = float(entry[value_field])
                x = np.append(x, lon)
                y = np.append(y, lat)
                z = np.append(z, value)
            except Exception:
                continue
    return x, y, z

def to_isobands(out_file, contours, layer_name="bands", field="wind", of="GeoJSON"):

  drv = ogr.GetDriverByName(of)

  if exists(out_file):
      remove(out_file)

  print(out_file) 
  dst_ds = drv.CreateDataSource( out_file )

  dst_layer = dst_ds.CreateLayer(layer_name, geom_type = ogr.wkbPolygon)
  fdef = ogr.FieldDefn( field, ogr.OFTReal )
  dst_layer.CreateField( fdef )

  for level in range(len(contours.collections)):
      paths = contours.collections[level].get_paths()
      for path in paths:

          feat_out = ogr.Feature( dst_layer.GetLayerDefn())
          feat_out.SetField(field, contours.levels[level] )
          pol = ogr.Geometry(ogr.wkbPolygon)


          ring = None

          for i in range(len(path.vertices)):
              point = path.vertices[i]
              if path.codes[i] == 1:
                  if ring != None:
                      pol.AddGeometry(ring)
                  ring = ogr.Geometry(ogr.wkbLinearRing)

              ring.AddPoint_2D(point[0], point[1])


          pol.AddGeometry(ring)

          feat_out.SetGeometry(pol)
          if dst_layer.CreateFeature(feat_out) != 0:
              print "Failed to create feature in shapefile.\n"
              exit( 1 )


          feat_out.Destroy()


if __name__ == "__main__":

    PARSER = ArgumentParser(
        description="Calculates the isobands from a raster into a vector file")
    PARSER.add_argument("src_file", help="The vectorial source file")
    PARSER.add_argument("out_file", help="The vectorial out file")
    PARSER.add_argument("-l",
        help="List of levels. ; is used as separator ", metavar = 'levels', type=str)
    PARSER.add_argument("-nln",
        help="The out layer name  (default bands)",
        default = 'bands', metavar = 'layer_name')
    PARSER.add_argument("-a",
        help="The layer attribute name  (default wind)",
        default = 'wind', metavar = 'attr_name')
    PARSER.add_argument("-f",
        help="The output file format name  (default ESRI Shapefile)",
        default = 'GeoJSON', metavar = 'formatname')
    PARSER.add_argument("-tl",
        help="CPU time limit (in seconds)",
        default = -1, metavar = 'cpu_time_limit', type=int)
    ARGS = PARSER.parse_args()

    if ARGS.tl > -1:
        rsrc = resource.RLIMIT_CPU
        soft, hard = resource.getrlimit(rsrc)
        resource.setrlimit(rsrc, (ARGS.tl, hard))
    
    x, y, z = read_data(ARGS.src_file, value_field=ARGS.a)
    x, y, z = remove_nan_observations(x, y, z)
    x, y, z = remove_repeat_coordinates(x, y, z)
    
    levels = [float(item) for item in ARGS.l.split(',')]

    gx, gy, img = interpolate(x, y, z, interp_type="rbf", hres=0.25, rbf_func='linear', rbf_smooth=1, spatial_pad=5)

    img = np.ma.masked_where(np.isnan(img), img)

    #view = basic_map(to_proj)

    #plt.contour(gx, gy, img, levels, linewidths=0.5, colors='k', extend='max')
    contours = plt.contourf(gx, gy, img, levels, cmap=plt.cm.jet)
    #plt.show()

    to_isobands(ARGS.out_file, contours, layer_name=ARGS.nln, field=ARGS.a, of=ARGS.f)

#COPY (Select metar.* From metar, states WHERE ST_Within(ST_SetSRID(ST_MakePoint(longitude, latitude),4326), geom) AND state != 'ak')  TO '/tmp/metar.csv' DELIMITER ',' CSV HEADER;